import { Socket } from "socket.io";
import { RoomManager } from "./RoomManager";
import UserModel from "../models/User";
import { logger } from "../config/logger";

export interface User {
    socket: Socket;
    name: string;
    email: string;
    interests?: string[];
}

export class UserManager {
    private users: User[];
    private queue: string[];
    private roomManager: RoomManager;
    
    constructor() {
        this.users = [];
        this.queue = [];
        this.roomManager = new RoomManager();
    }

    async addUser(name: string, email: string, socket: Socket, interests?: string[]) {
        // Check if user is banned
        try {
            const existingUser = await UserModel.findOne({ socketId: socket.id });
            if (existingUser?.isBanned) {
                socket.emit("error", { message: "You have been banned from this service" });
                socket.disconnect();
                return;
            }
        } catch (error) {
            logger.error(`Error checking user ban status: ${error}`);
        }

        const user: User = {
            name,
            email,
            socket,
            interests: interests || []
        };
        this.users.push(user);
        this.queue.push(socket.id);
        socket.emit("lobby");
        
        // Save/update user in database
        try {
            await UserModel.findOneAndUpdate(
                { email: email.toLowerCase() },
                {
                    socketId: socket.id,
                    name,
                    interests: interests || [],
                    lastActive: new Date(),
                },
                { upsert: true, new: true }
            );
        } catch (error) {
            logger.error(`Error saving user to database: ${error}`);
        }

        this.clearQueue();
        this.initHandlers(socket);
    }

    async removeUser(socketId: string) {
        const user = this.users.find(x => x.socket.id === socketId);
        
        // Clean up room if user is in one
        const roomId = this.roomManager.getRoomBySocketId(socketId);
        if (roomId) {
            await this.roomManager.deleteRoom(roomId);
            // Notify the other user - we'll get them from RoomManager
            const otherUser = this.getOtherUserInRoom(socketId, roomId);
            if (otherUser && otherUser.socket.connected) {
                otherUser.socket.emit("user-disconnected");
                otherUser.socket.emit("lobby");
                // Re-add to queue
                this.queue.push(otherUser.socket.id);
                this.clearQueue();
            }
        }
        
        this.users = this.users.filter(x => x.socket.id !== socketId);
        this.queue = this.queue.filter(x => x !== socketId);
        
        logger.info(`User ${socketId} removed`);
    }

    private getOtherUserInRoom(socketId: string, roomId: string): User | null {
        // Get room data from RoomManager to find the other user
        // Access private rooms map through a public method
        const room = (this.roomManager as any).rooms?.get(roomId);
        if (!room) return null;
        
        const otherSocketId = room.user1.socket.id === socketId 
            ? room.user2.socket.id 
            : room.user1.socket.id;
        
        return this.users.find(u => u.socket.id === otherSocketId) || null;
    }

    clearQueue() {
        if (this.queue.length < 2) {
            return;
        }

        let matched = false;

        for (let i = 0; i < this.queue.length; i++) {
            for (let j = i + 1; j < this.queue.length; j++) {
                const user1 = this.users.find(x => x.socket.id === this.queue[i]);
                const user2 = this.users.find(x => x.socket.id === this.queue[j]);

                if (!user1 || !user2 || !user1.socket.connected || !user2.socket.connected) continue;

                const hasSharedInterests = user1.interests?.some(interest => 
                    user2.interests?.map(i => i.toLowerCase()).includes(interest.toLowerCase())
                );

                if (hasSharedInterests || !user1.interests?.length || !user2.interests?.length) {
                    const id1 = this.queue[i];
                    const id2 = this.queue[j];
                    
                    this.queue.splice(j, 1);
                    this.queue.splice(i, 1);
                    
                    logger.info(`Matching users: ${user1.name} and ${user2.name}`);
                    this.roomManager.createRoom(user1, user2);
                    matched = true;
                    break;
                }
            }
            if (matched) break;
        }

        if (!matched && this.queue.length >= 2) {
            const id1 = this.queue.pop();
            const id2 = this.queue.pop();
            if (id1 && id2) {
                const user1 = this.users.find(x => x.socket.id === id1);
                const user2 = this.users.find(x => x.socket.id === id2);
                if (user1 && user2 && user1.socket.connected && user2.socket.connected) {
                    logger.info(`Matching users randomly: ${user1.name} and ${user2.name}`);
                    this.roomManager.createRoom(user1, user2);
                    matched = true;
                }
            }
        }

        if (matched) {
            this.clearQueue();
        }
    }

    initHandlers(socket: Socket) {
        socket.on("offer", ({sdp, roomId}: {sdp: string, roomId: string}) => {
            this.roomManager.onOffer(roomId, sdp, socket.id);
        })

        socket.on("answer",({sdp, roomId}: {sdp: string, roomId: string}) => {
            this.roomManager.onAnswer(roomId, sdp, socket.id);
        })

        socket.on("add-ice-candidate", ({candidate, roomId, type}) => {
            this.roomManager.onIceCandidates(roomId, socket.id, candidate, type);
        });

        socket.on("report-user", async ({roomId}: {roomId: string}) => {
            const reported = await this.roomManager.reportRoom(roomId, socket.id);
            if (reported) {
                socket.emit("report-success");
            }
        });

        socket.on("chat-message", ({ roomId, message }: { roomId?: string, message: string }) => {
            const resolvedRoomId = roomId || this.roomManager.getRoomBySocketId(socket.id);
            if (!resolvedRoomId) {
                return;
            }
            this.roomManager.forwardChatMessage(resolvedRoomId, socket.id, message);
        });

        socket.on("video-filter", ({ roomId, filter }: { roomId?: string, filter: string }) => {
            const resolvedRoomId = roomId || this.roomManager.getRoomBySocketId(socket.id);
            if (!resolvedRoomId) return;
            this.roomManager.forwardVideoFilter(resolvedRoomId, socket.id, filter);
        });

        socket.on("send-friend-request", ({ roomId }: { roomId?: string }) => {
            const resolvedRoomId = roomId || this.roomManager.getRoomBySocketId(socket.id);
            if (!resolvedRoomId) return;
            this.roomManager.sendFriendRequest(resolvedRoomId, socket.id);
        });

        socket.on("accept-friend-request", async ({ senderEmail }: { senderEmail: string }) => {
            const currentUser = await UserModel.findOne({ socketId: socket.id });
            if (!currentUser) return;
            
            await UserModel.findOneAndUpdate(
                { email: currentUser.email },
                { $addToSet: { friends: senderEmail } }
            );
            await UserModel.findOneAndUpdate(
                { email: senderEmail },
                { $addToSet: { friends: currentUser.email } }
            );
            
            socket.emit("friend-added", { email: senderEmail });
            const senderSocket = this.users.find(u => u.email === senderEmail)?.socket;
            if (senderSocket && senderSocket.connected) {
                senderSocket.emit("friend-added", { email: currentUser.email, name: currentUser.name });
            }
        });

        socket.on("disconnect-room", async () => {
            const roomId = this.roomManager.getRoomBySocketId(socket.id);
            if (!roomId) {
                return;
            }

            const participants = this.roomManager.getRoomParticipants(roomId);
            await this.roomManager.deleteRoom(roomId);

            socket.emit("lobby");
            this.queue.push(socket.id);

            if (participants) {
                const otherUser = participants.user1.socket.id === socket.id
                    ? participants.user2
                    : participants.user1;

                if (otherUser?.socket.connected) {
                    otherUser.socket.emit("user-disconnected");
                    otherUser.socket.emit("lobby");
                    this.queue.push(otherUser.socket.id);
                }
            }

            this.clearQueue();
        });
    }

}