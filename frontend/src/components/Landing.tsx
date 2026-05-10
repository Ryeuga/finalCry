import { useEffect, useRef, useState } from "react"
import { Room } from "./Room";

const BACKEND_URL = (import.meta as any).env?.VITE_BACKEND_URL || `http://${window.location.hostname}:3000`;

export const Landing = () => {
    const [email, setEmail] = useState("");
    const [name, setName] = useState("");
    const [interestsInput, setInterestsInput] = useState("");
    const [step, setStep] = useState<'email' | 'name'>('email');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
    const [localAudioTrack, setLocalAudioTrack] = useState<MediaStreamTrack | null>(null);
    const [localVideoTrack, setlocalVideoTrack] = useState<MediaStreamTrack | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [theme, setTheme] = useState<'light' | 'dark'>('dark');
    const [showFriends, setShowFriends] = useState(false);
    const [friendsList, setFriendsList] = useState<any[]>([]);

    const fetchFriends = async () => {
        if (!verifiedEmail) return;
        try {
            const response = await fetch(`${BACKEND_URL}/api/auth/friends?email=${encodeURIComponent(verifiedEmail)}`);
            if (response.ok) {
                const data = await response.json();
                setFriendsList(data.friends || []);
            }
        } catch (err) {
            console.error("Failed to fetch friends", err);
        }
    };

    useEffect(() => {
        if (showFriends) {
            fetchFriends();
        }
    }, [showFriends]);

useEffect(() => {
    document.body.className = theme === 'dark' ? 'dark-mode' : '';
}, [theme]);
    const [joined, setJoined] = useState(false);

    const getCam = async () => {
        try {
            const stream = await window.navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            })
            // MediaStream
            const audioTrack = stream.getAudioTracks()[0]
            const videoTrack = stream.getVideoTracks()[0]
            setLocalAudioTrack(audioTrack);
            setlocalVideoTrack(videoTrack);
            if (videoRef.current) {
                // Stop any existing playback to prevent interruption
                if (videoRef.current.srcObject) {
                    const oldStream = videoRef.current.srcObject as MediaStream;
                    oldStream.getTracks().forEach(track => track.stop());
                }
                videoRef.current.srcObject = new MediaStream([videoTrack])
                videoRef.current.play().catch(err => {
                    if (err.name !== 'AbortError') {
                        console.error("Error playing video:", err);
                    }
                });
            }
        } catch (error) {
            console.error("Error accessing camera/microphone:", error);
            alert("Could not access camera/microphone. Please allow permissions and refresh the page.");
        }
    }

    useEffect(() => {
        getCam();
    }, []);

    useEffect(() => {
        if (!videoRef.current || !localVideoTrack) {
            return;
        }

        const currentStream = videoRef.current.srcObject as MediaStream | null;
        const currentTrack = currentStream?.getVideoTracks()[0];

        // Only stop the preview track if it's different from the incoming track.
        if (currentTrack && currentTrack !== localVideoTrack) {
            currentTrack.stop();
        }

        if (currentTrack !== localVideoTrack) {
            videoRef.current.srcObject = new MediaStream([localVideoTrack]);
        }

        videoRef.current
            .play()
            .catch(err => {
                if (err.name !== 'AbortError') {
                    console.error("Error playing video:", err);
                }
            });
    }, [localVideoTrack, videoRef]);

    const verifyEmail = async () => {
        if (!email.trim()) {
            setError('Please enter your college email');
            return;
        }

        setLoading(true);
        setError("");

        console.log('Backend URL:', BACKEND_URL);
        console.log('Attempting to verify email:', email.trim());

        try {
            // Add timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

            const response = await fetch(`${BACKEND_URL}/api/auth/verify-email`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    email: email.trim(),
                    name: name.trim() || 'User'
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Invalid response' }));
                setError(errorData.error || 'Invalid email address');
                setLoading(false);
                return;
            }

            const data = await response.json();

            setVerifiedEmail(email.trim());
            if (data.user && data.user.name) {
                setName(data.user.name);
            }
            setStep('name');
            setLoading(false);
        } catch (error: any) {
            console.error('Error verifying email:', error);
            console.error('Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            
            if (error.name === 'AbortError') {
                setError('Request timed out. Please check your connection and try again.');
            } else {
                setError('Failed to verify email. Please try again.');
            }
            setLoading(false);
        }
    };

    const handleStartChatting = () => {
        if (!name.trim()) {
            setError('Please enter your name');
            return;
        }
        if (!verifiedEmail) {
            setError('Please verify your email first');
            return;
        }
        setJoined(true);
    };

    const handleLeaveRoom = () => {
        setJoined(false);
    };

    if (!joined) {
        return (
            <div className="landing-screen">
                <div className="background-glow" />
                <header className="landing-nav" style={{ justifyContent: 'flex-start' }}>
                    <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <h2 style={{ margin: 0 }}>Newton Network</h2>
                    </div>
                </header>

                <section className="landing-hero">
                    <div className="hero-content">
                        <p className="tagline">Newton network</p>
                        <h1>Meet blue-badged students in seconds.</h1>
                        <p className="subhead">
                            Jump into spontaneous video conversations with learners across the Newton School ecosystem.
                            Every profile is email-verified for a trusted, campus-only vibe.
                        </p>

                        <div className="hero-stats">
                            <div className="stat-pill">
                                <span className="stat-value">1200+</span>
                                <span className="stat-label">Active peers</span>
                            </div>
                            <div className="stat-pill">
                                <span className="stat-value">24/7</span>
                                <span className="stat-label">Matching</span>
                            </div>
                            <div className="stat-pill">
                                <span className="stat-value"><span role="img" aria-label="shield">🛡️</span> Safe</span>
                                <span className="stat-label">Real identities</span>
                            </div>
                        </div>

                        <div className="hero-benefits">
                            <div className="benefit">
                                <span className="benefit-icon">✨</span>
                                <div>
                                    <p className="benefit-title">Smart matchmaking</p>
                                    <p className="benefit-copy">Optimized for relevant interests & timezones.</p>
                                </div>
                            </div>
                            <div className="benefit">
                                <span className="benefit-icon">🔐</span>
                                <div>
                                    <p className="benefit-title">Secure & moderated</p>
                                    <p className="benefit-copy">Newton community guidelines built-in.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="hero-panel">
                        <div className="panel-card preview-panel">
                            <span className="preview-label">Live preview</span>
                            <div className="preview-video">
                                <video
                                    autoPlay
                                    ref={videoRef}
                                    className="video-frame mirror"
                                    muted
                                ></video>
                            </div>
                        </div>

                        <div className="panel-card form-wrapper">
                            {error && (
                                <div className="alert">
                                    {error}
                                </div>
                            )}

                            {step === 'email' && (
                                <div className="form-section">
                                    <label className="field-label">
                                        Enter your Newton email
                                    </label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="you@newtonschool.edu"
                                        className="input-field"
                                        onKeyPress={(e) => {
                                            if (e.key === 'Enter' && email.trim()) {
                                                verifyEmail();
                                            }
                                        }}
                                    />
                                    <p className="helper-text">
                                        Only verified Newton domains are accepted. For testing, use test@test.test
                                    </p>
                                    <button
                                        onClick={verifyEmail}
                                        disabled={!email.trim() || loading}
                                        className="btn primary"
                                    >
                                        {loading ? 'Verifying…' : 'Continue'}
                                    </button>
                                </div>
                            )}

                            {step === 'name' && (
                                <div className="form-section">
                                    <p className="verified-pill">
                                        ✓ Email verified: {verifiedEmail}
                                    </p>
                                    <label className="field-label">
                                        Enter your name
                                    </label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Your name"
                                        className="input-field"
                                    />
                                    <label className="field-label" style={{marginTop: '10px'}}>
                                        Interests (comma separated)
                                    </label>
                                    <input
                                        type="text"
                                        value={interestsInput}
                                        onChange={(e) => setInterestsInput(e.target.value)}
                                        placeholder="e.g. coding, music, gaming"
                                        className="input-field"
                                        onKeyPress={(e) => {
                                            if (e.key === 'Enter' && name.trim()) {
                                                handleStartChatting();
                                            }
                                        }}
                                    />
                                    <div className="actions-row">
                                        <button
                                            onClick={() => {
                                                setStep('email');
                                                setError('');
                                                setShowFriends(false);
                                            }}
                                            className="btn secondary"
                                        >
                                            Back
                                        </button>
                                        <button
                                            onClick={handleStartChatting}
                                            disabled={!name.trim()}
                                            className="btn primary"
                                        >
                                            Start Chatting
                                        </button>
                                    </div>
                                    <div className="actions-row" style={{marginTop: '16px'}}>
                                        <button onClick={() => setShowFriends(!showFriends)} className="btn ghost" style={{flex: 1}}>
                                            {showFriends ? 'Hide Friends' : 'My Friends'}
                                        </button>
                                    </div>
                                    {showFriends && (
                                        <div style={{marginTop: '16px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px'}}>
                                            <h4 style={{marginBottom: '8px', color: 'var(--text-primary)'}}>Friends List</h4>
                                            {friendsList.length === 0 ? (
                                                <p style={{fontSize: '14px', color: 'var(--text-secondary)'}}>No friends yet. Start chatting to make some!</p>
                                            ) : (
                                                <ul style={{listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px'}}>
                                                    {friendsList.map((f, i) => (
                                                        <li key={i} style={{display: 'flex', justifyContent: 'space-between', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', alignItems: 'center'}}>
                                                            <span style={{fontWeight: 500, color: 'var(--text-primary)'}}>{f.name}</span>
                                                            <span style={{color: 'var(--text-secondary)', fontSize: '12px'}}>{f.email}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </section>
                <button 
    className="theme-toggle"
    onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
    title="Switch Theme"
>
    {theme === 'light' ? (
        // When Light: Show Moon (to switch to dark)
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
    ) : (
        // When Dark: Show Sun (to switch to light)
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
    )}
</button>
            </div>
        )
    }

    return (
        <Room 
            name={name} 
            email={verifiedEmail || ''} 
            interests={interestsInput.split(',').map(i => i.trim()).filter(i => i)}
            localAudioTrack={localAudioTrack} 
            localVideoTrack={localVideoTrack}
            onLeave={handleLeaveRoom}
        />
    )
}