import { useEffect, useRef, useState } from "react";
import { Socket, io } from "socket.io-client";

// Use backend URL from env if provided, otherwise use the current page host.
// This allows opening the app from another device on the same network without code changes.
const BACKEND_HOST = (import.meta as any).env?.VITE_BACKEND_URL || window.location.hostname;
const URL = BACKEND_HOST.startsWith('http') ? BACKEND_HOST : `http://${BACKEND_HOST}:3000`;

type ChatMessage = {
    id: string;
    text: string;
    sender: 'me' | 'peer';
    senderName: string;
    timestamp: string;
};

export const Room = ({
    name,
    email,
    interests,
    localAudioTrack,
    localVideoTrack,
    onLeave
}: {
    name: string,
    email: string,
    interests: string[],
    localAudioTrack: MediaStreamTrack | null,
    localVideoTrack: MediaStreamTrack | null,
    onLeave: () => void,
}) => {
    const [lobby, setLobby] = useState(true);
    const [socket, setSocket] = useState<null | Socket>(null);
    const sendingPcRef = useRef<RTCPeerConnection | null>(null);
    const receivingPcRef = useRef<RTCPeerConnection | null>(null);
    const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const chatBottomRef = useRef<HTMLDivElement | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [videoFilter, setVideoFilter] = useState('');
    const [remoteVideoFilter, setRemoteVideoFilter] = useState('');
    const [friendRequestReceived, setFriendRequestReceived] = useState<{senderName: string, senderEmail: string} | null>(null);
    const [friendAdded, setFriendAdded] = useState(false);
    const [friendRequestSent, setFriendRequestSent] = useState(false);
    const [rtcConfig, setRtcConfig] = useState<RTCConfiguration | undefined>();
    const rtcConfigRef = useRef<RTCConfiguration | undefined>();
    const [isSelfEnlarged, setIsSelfEnlarged] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(true);

    useEffect(() => {
        fetch(`${URL}/api/rtc-config`)
            .then(res => res.json())
            .then(data => {
                setRtcConfig(data.config);
                rtcConfigRef.current = data.config;
            })
            .catch(err => console.error("Failed to fetch RTC config", err));
    }, []);

    const handleScreenShare = async () => {
        if (!isScreenSharing) {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];
                
                if (sendingPcRef.current) {
                    const sender = sendingPcRef.current.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) sender.replaceTrack(screenTrack);
                }
                
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = new MediaStream([screenTrack]);
                }
                
                setIsScreenSharing(true);
                
                screenTrack.onended = () => stopScreenShare();
            } catch (err) {
                console.error("Screen share error", err);
            }
        } else {
            stopScreenShare();
        }
    };

    const stopScreenShare = () => {
        if (localVideoTrack) {
            if (sendingPcRef.current) {
                const sender = sendingPcRef.current.getSenders().find(s => s.track?.kind === 'video');
                if (sender) sender.replaceTrack(localVideoTrack);
            }
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = new MediaStream([localVideoTrack]);
            }
        }
        setIsScreenSharing(false);
    };

    const handleRemoteTrack = (event: RTCTrackEvent) => {
        const videoElement = remoteVideoRef.current;
        if (!videoElement) {
            return;
        }

        const incomingStream = event.streams?.[0];
        if (incomingStream && videoElement.srcObject !== incomingStream) {
            videoElement.srcObject = incomingStream;
        } else if (!incomingStream) {
            const currentStream = (videoElement.srcObject as MediaStream | null) ?? new MediaStream();
            const alreadyAdded = currentStream.getTracks().some(track => track.id === event.track.id);
            if (!alreadyAdded) {
                currentStream.addTrack(event.track);
            }
            if (videoElement.srcObject !== currentStream) {
                videoElement.srcObject = currentStream;
            }
        }

        videoElement.play().catch(err => {
            if (err.name !== "AbortError") {
                console.error("Failed to start remote video", err);
            }
        });
    };

    useEffect(() => {
        const socket = io(URL);
        
        // Send join event with email and name
        socket.emit('join', { email, name, interests });
        
        socket.on('error', ({ message }: { message: string }) => {
            alert(message);
        });
        
        socket.on('user-disconnected', () => {
            setLobby(true);
            alert('The other user disconnected. Searching for a new match...');
        });

        socket.on("chat-message", ({ roomId: incomingRoomId, message, senderName, timestamp }: { roomId: string, message: string, senderName: string, timestamp: string }) => {
            setMessages(prev => ([
                ...prev,
                {
                    id: `${incomingRoomId}-${Date.now()}`,
                    text: message,
                    sender: 'peer',
                    senderName: senderName || 'Stranger',
                    timestamp: timestamp || new Date().toISOString()
                }
            ]));
        });

        socket.on("video-filter", ({ filter }: { filter: string }) => {
            setRemoteVideoFilter(filter);
        });

        socket.on("receive-friend-request", (data: { senderName: string, senderEmail: string }) => {
            setFriendRequestReceived(data);
        });
        
        socket.on("friend-added", () => {
            setFriendAdded(true);
            setFriendRequestReceived(null);
            setFriendRequestSent(false);
        });
        
        socket.on('send-offer', async ({roomId}) => {
            console.log("sending offer");
            setLobby(false);
            setCurrentRoomId(roomId);
            const defaultIce = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
            const pc = new RTCPeerConnection(rtcConfigRef.current || defaultIce);

            sendingPcRef.current = pc;
            const localStream = new MediaStream();
            if (localVideoTrack) {
                localStream.addTrack(localVideoTrack);
            }
            if (localAudioTrack) {
                localStream.addTrack(localAudioTrack);
            }
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

            pc.onicecandidate = async (e) => {
                console.log("receiving ice candidate locally");
                if (e.candidate) {
                   socket.emit("add-ice-candidate", {
                    candidate: e.candidate,
                    type: "sender",
                    roomId
                   })
                }
            }

            pc.onnegotiationneeded = async () => {
                console.log("on negotiation neeeded, sending offer");
                const sdp = await pc.createOffer();
                //@ts-ignore
                pc.setLocalDescription(sdp)
                socket.emit("offer", {
                    sdp,
                    roomId
                })
            }

            pc.ontrack = handleRemoteTrack;
        });

        socket.on("offer", async ({roomId, sdp: remoteSdp}) => {
            console.log("received offer");
            setLobby(false);
            setCurrentRoomId(roomId);
            const defaultIce = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
            const pc = new RTCPeerConnection(rtcConfigRef.current || defaultIce);
            receivingPcRef.current = pc;
            const localStream = new MediaStream();
            if (localVideoTrack) {
                localStream.addTrack(localVideoTrack);
            }
            if (localAudioTrack) {
                localStream.addTrack(localAudioTrack);
            }
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
            pc.setRemoteDescription(remoteSdp)
            const sdp = await pc.createAnswer();
            //@ts-ignore
            pc.setLocalDescription(sdp)
            pc.ontrack = handleRemoteTrack;

            pc.onicecandidate = async (e) => {
                if (!e.candidate) {
                    return;
                }
                console.log("omn ice candidate on receiving seide");
                if (e.candidate) {
                   socket.emit("add-ice-candidate", {
                    candidate: e.candidate,
                    type: "receiver",
                    roomId
                   })
                }
            }

            socket.emit("answer", {
                roomId,
                sdp: sdp
            });
        });

        socket.on("answer", ({ sdp: remoteSdp }) => {
            setLobby(false);
            if (sendingPcRef.current) {
                sendingPcRef.current.setRemoteDescription(remoteSdp).catch(err => console.error("Error setting remote answer", err));
            }
            console.log("loop closed");
        })

        socket.on("lobby", () => {
            setLobby(true);
        })

        socket.on("add-ice-candidate", ({candidate, type}) => {
            console.log("add ice candidate from remote", {candidate, type});
            if (type == "sender") {
                if (receivingPcRef.current) {
                    receivingPcRef.current.addIceCandidate(candidate).catch(err => console.error("ICE error receiver", err));
                } else {
                    console.error("receiving pc not found");
                }
            } else {
                if (sendingPcRef.current) {
                    sendingPcRef.current.addIceCandidate(candidate).catch(err => console.error("ICE error sender", err));
                } else {
                    console.error("sending pc not found");
                }
            }
        })

        setSocket(socket)

        return () => {
            socket.disconnect();
        }
    }, [name])

    useEffect(() => {
        if (!localVideoRef.current || !localVideoTrack) return;

        localVideoRef.current.srcObject = new MediaStream([localVideoTrack]);
        localVideoRef.current.play().catch((err) => {
            if (err.name !== "AbortError") {
                console.error("Failed to start local video preview", err);
            }
        });
    }, [localVideoTrack])

    useEffect(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (lobby) {
            setMessages([]);
            setRemoteVideoFilter('');
            setFriendRequestReceived(null);
            setFriendAdded(false);
            setFriendRequestSent(false);
        }
    }, [lobby]);

    useEffect(() => {
        if (socket && currentRoomId) {
            socket.emit("video-filter", { roomId: currentRoomId, filter: videoFilter });
        }
    }, [videoFilter, currentRoomId, socket]);

    const handleDisconnect = () => {
        if (socket && currentRoomId) {
            socket.emit('disconnect-room');
            setLobby(true);
            setCurrentRoomId(null);
            setMessages([]);
            setChatInput('');
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = null;
            }
            // Clean up peer connections
            if (sendingPcRef.current) {
                sendingPcRef.current.close();
                sendingPcRef.current = null;
            }
            if (receivingPcRef.current) {
                receivingPcRef.current.close();
                receivingPcRef.current = null;
            }
        }
    };

    const handleCancelSearch = () => {
        if (sendingPcRef.current) {
            sendingPcRef.current.close();
            sendingPcRef.current = null;
        }
        if (receivingPcRef.current) {
            receivingPcRef.current.close();
            receivingPcRef.current = null;
        }
        setMessages([]);
        setChatInput('');
        setCurrentRoomId(null);
        setLobby(true);
        if (socket) {
            socket.disconnect();
            setSocket(null);
        }
        onLeave();
    };

    const handleReport = () => {
        if (socket && currentRoomId) {
            if (confirm('Are you sure you want to report this user?')) {
                socket.emit('report-user', { roomId: currentRoomId });
                handleDisconnect();
            }
        }
    };

    const handleSendMessage = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!socket || !currentRoomId) return;
        const text = chatInput.trim();
        if (!text) return;

        const newMessage: ChatMessage = {
            id: `${currentRoomId}-${Date.now()}`,
            text,
            sender: 'me',
            senderName: name,
            timestamp: new Date().toISOString()
        };

        setMessages(prev => [...prev, newMessage]);
        socket.emit('chat-message', { roomId: currentRoomId, message: text });
        setChatInput('');
    };

    const handleSendFriendRequest = () => {
        if (socket && currentRoomId) {
            socket.emit("send-friend-request", { roomId: currentRoomId });
            setFriendRequestSent(true);
        }
    };

    const handleAcceptFriendRequest = () => {
        if (socket && friendRequestReceived) {
            socket.emit("accept-friend-request", { senderEmail: friendRequestReceived.senderEmail });
        }
    };

    const roomStateClasses = lobby ? '' : 'room-connected';

    return (
        <div className={`room-container ${roomStateClasses}`}>
            <div className="room-content">
                <div className="video-section">
                    {/* Top info */}
                    <div className="top-overlay">
                        <p className="top-username">Signed in as {name}</p>
                        <div className="top-points">
                            <span className="golden-bullet"></span>
                            Points: 128 [to be added]
                        </div>
                    </div>

                    {/* Videos */}
                    <div className="video-fullscreen-container">
                        {friendRequestReceived && !friendAdded && (
                            <div className="friend-request-overlay">
                                <span style={{color: 'white'}}>{friendRequestReceived.senderName} sent you a friend request!</span>
                                <button onClick={handleAcceptFriendRequest} className="btn primary btn-sm">Accept</button>
                                <button onClick={() => setFriendRequestReceived(null)} className="btn ghost btn-sm">Decline</button>
                            </div>
                        )}
                        
                        <div 
                            className={`video-card ${isSelfEnlarged ? 'fullscreen-video' : 'pip-video'}`}
                            onClick={() => !isSelfEnlarged && setIsSelfEnlarged(true)}
                        >
                            <div className="video-meta">
                                <h3>You</h3>
                                <span>{lobby ? 'Camera preview' : 'Live now'}</span>
                            </div>
                            <video
                                autoPlay
                                playsInline
                                ref={localVideoRef}
                                className={`video-frame ${!isScreenSharing ? 'mirror' : ''}`}
                                style={{ filter: videoFilter }}
                                muted
                            />
                        </div>

                        <div 
                            className={`video-card ${!isSelfEnlarged ? 'fullscreen-video' : 'pip-video'}`}
                            onClick={() => isSelfEnlarged && setIsSelfEnlarged(false)}
                        >
                            {lobby ? (
                                <div className="centered-searching-overlay">
                                    <h3>Searching for a match...</h3>
                                    <p>Hang tight, we are pairing you.</p>
                                </div>
                            ) : (
                                <div className="video-meta">
                                    <h3>Stranger</h3>
                                    <span>You are connected</span>
                                </div>
                            )}
                            <video 
                                autoPlay 
                                playsInline
                                ref={remoteVideoRef}
                                className="video-frame"
                                style={{ filter: remoteVideoFilter }}
                            />
                        </div>
                    </div>



            {/* Bottom Feature Bar */}
            <div className="transparent-feature-bar">
                <button onClick={handleScreenShare} className="btn ghost feature-btn" disabled={lobby} title="Share Screen">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"/><polyline points="14 2 14 8 20 8"/><path d="M2 15h10"/><path d="m9 18 3-3-3-3"/></svg>
                    <span>{isScreenSharing ? 'Stop Share' : 'Share'}</span>
                </button>
                <div className="feature-select-wrapper">
                    <select 
                        className="feature-select" 
                        value={videoFilter} 
                        onChange={(e) => setVideoFilter(e.target.value)}
                    >
                        <option value="">Filter: None</option>
                        <option value="grayscale(100%)">B&W</option>
                        <option value="sepia(100%)">Sepia</option>
                        <option value="blur(4px)">Blur</option>
                    </select>
                </div>
                <button 
                    onClick={handleSendFriendRequest}
                    className="btn ghost feature-btn"
                    disabled={lobby || friendAdded || friendRequestSent}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                    <span>{friendAdded ? 'Friends ✓' : friendRequestSent ? 'Request Sent' : 'Add Friend'}</span>
                </button>
                <button 
                    onClick={handleReport}
                    className="btn ghost feature-btn"
                    disabled={lobby}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
                    <span>Report</span>
                </button>
                <button 
                    onClick={lobby ? handleCancelSearch : handleDisconnect}
                    className={`btn feature-btn ${lobby ? 'secondary' : 'danger'}`}
                >
                    {lobby ? 'Cancel Search' : (
                        <>
                            <span>Skip</span>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                        </>
                    )}
                </button>
            </div>
            </div>

            {/* Chat Section */}
            <div className={`chat-section ${isChatOpen ? 'expanded' : 'retracted'}`}>
                <button className="chat-slide-btn" onClick={() => setIsChatOpen(!isChatOpen)}>
                    <svg className={`chevron ${!isChatOpen ? 'flipped' : ''}`} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
                <div className="chat-content">
                    <div className="chat-header">
                        <h4>Live chat</h4>
                    </div>
                    <div className="chat-messages">
                        {messages.length === 0 && (
                            <p className="chat-empty">Keep chatting while the video stays live.</p>
                        )}
                        {messages.map(message => (
                            <div
                                key={message.id}
                                className={`chat-message ${message.sender === 'me' ? 'self' : 'peer'}`}
                            >
                                <span className="chat-author">{message.sender === 'me' ? 'You' : message.senderName}</span>
                                <p>{message.text}</p>
                            </div>
                        ))}
                        <div ref={chatBottomRef} />
                    </div>
                    <form className="chat-input-row" onSubmit={handleSendMessage}>
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder={lobby ? 'Chat unlocks once connected…' : 'Type a message'}
                            className="input-field"
                        />
                        <button
                            type="submit"
                            className="btn primary"
                            disabled={lobby || !chatInput.trim()}
                        >
                            Send
                        </button>
                    </form>
                </div>
            </div>
            </div>
        </div>
    )
}

