import { User } from "./UserManger";
import { Room, IRoom } from "../models/Room";
import { logger } from "../config/logger";

let GLOBAL_ROOM_ID = 1;

interface RoomData {
    user1: User,
    user2: User,
    createdAt: Date;
}

export class RoomManager {
    private rooms: Map<string, RoomData>
    constructor() {
        this.rooms = new Map<string, RoomData>()
    }

    async createRoom(user1: User, user2: User) {
        const roomId = this.generate().toString();
        const roomData: RoomData = {
            user1, 
            user2,
            createdAt: new Date()
        };
        this.rooms.set(roomId.toString(), roomData);

        // Save to database
        try {
            await Room.create({
                roomId,
                user1SocketId: user1.socket.id,
                user2SocketId: user2.socket.id,
                user1Name: user1.name,
                user2Name: user2.name,
            });
            logger.info(`Room ${roomId} created between ${user1.name} and ${user2.name}`);
        } catch (error) {
            logger.error(`Error saving room to database: ${error}`);
        }

        user1.socket.emit("send-offer", {
            roomId
        })

        user2.socket.emit("send-offer", {
            roomId
        })
    }

    async deleteRoom(roomId: string) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }

        // Update database
        try {
            const roomDoc = await Room.findOne({ roomId });
            if (roomDoc) {
                roomDoc.endedAt = new Date();
                roomDoc.duration = Date.now() - roomDoc.createdAt.getTime();
                await roomDoc.save();
            }
        } catch (error) {
            logger.error(`Error updating room in database: ${error}`);
        }

        this.rooms.delete(roomId);
        logger.info(`Room ${roomId} deleted`);
    }

    getRoomBySocketId(socketId: string): string | null {
        for (const [roomId, room] of this.rooms.entries()) {
            if (room.user1.socket.id === socketId || room.user2.socket.id === socketId) {
                return roomId;
            }
        }
        return null;
    }

    getRoomParticipants(roomId: string): RoomData | null {
        const room = this.rooms.get(roomId);
        if (!room) {
            return null;
        }
        return room;
    }

    async reportRoom(roomId: string, reporterSocketId: string) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return false;
        }

        try {
            const roomDoc = await Room.findOne({ roomId });
            if (roomDoc && !roomDoc.reportedBy?.includes(reporterSocketId)) {
                roomDoc.reportedBy = roomDoc.reportedBy || [];
                roomDoc.reportedBy.push(reporterSocketId);
                await roomDoc.save();
                logger.warn(`Room ${roomId} reported by ${reporterSocketId}`);
                return true;
            }
        } catch (error) {
            logger.error(`Error reporting room: ${error}`);
        }
        return false;
    }

    onOffer(roomId: string, sdp: string, senderSocketid: string) {
        const room = this.rooms.get(roomId);
        if (!room) {
            logger.warn(`Room ${roomId} not found for offer`);
            return;
        }
        const receivingUser = room.user1.socket.id === senderSocketid ? room.user2: room.user1;
        if (receivingUser && receivingUser.socket.connected) {
            receivingUser.socket.emit("offer", {
                sdp,
                roomId
            });
        }
    }
    
    onAnswer(roomId: string, sdp: string, senderSocketid: string) {
        const room = this.rooms.get(roomId);
        if (!room) {
            logger.warn(`Room ${roomId} not found for answer`);
            return;
        }
        const receivingUser = room.user1.socket.id === senderSocketid ? room.user2: room.user1;
        if (receivingUser && receivingUser.socket.connected) {
            receivingUser.socket.emit("answer", {
                sdp,
                roomId
            });
        }
    }

    onIceCandidates(roomId: string, senderSocketid: string, candidate: any, type: "sender" | "receiver") {
        const room = this.rooms.get(roomId);
        if (!room) {
            logger.warn(`Room ${roomId} not found for ICE candidate`);
            return;
        }
        const receivingUser = room.user1.socket.id === senderSocketid ? room.user2: room.user1;
        if (receivingUser && receivingUser.socket.connected) {
            receivingUser.socket.emit("add-ice-candidate", ({candidate, type}));
        }
    }

    forwardChatMessage(roomId: string, senderSocketId: string, message: string) {
        const trimmed = message?.trim();
        if (!trimmed) {
            return;
        }

        const room = this.rooms.get(roomId);
        if (!room) {
            logger.warn(`Room ${roomId} not found for chat message`);
            return;
        }

        const sender = room.user1.socket.id === senderSocketId ? room.user1 : room.user2;
        const recipient = sender.socket.id === room.user1.socket.id ? room.user2 : room.user1;

        if (!recipient || !recipient.socket.connected) {
            return;
        }

        recipient.socket.emit("chat-message", {
            roomId,
            message: trimmed,
            senderName: sender?.name || 'Stranger',
            timestamp: new Date().toISOString()
        });
    }

    forwardVideoFilter(roomId: string, senderSocketId: string, filter: string) {
        const room = this.rooms.get(roomId);
        if (!room) return;
        
        const recipient = room.user1.socket.id === senderSocketId ? room.user2 : room.user1;
        if (recipient && recipient.socket.connected) {
            recipient.socket.emit("video-filter", { roomId, filter });
        }
    }

    sendFriendRequest(roomId: string, senderSocketId: string) {
        const room = this.rooms.get(roomId);
        if (!room) return;
        const sender = room.user1.socket.id === senderSocketId ? room.user1 : room.user2;
        const recipient = room.user1.socket.id === senderSocketId ? room.user2 : room.user1;
        if (recipient && recipient.socket.connected) {
            recipient.socket.emit("receive-friend-request", { senderName: sender.name, senderEmail: sender.email });
        }
    }

    generate() {
        return GLOBAL_ROOM_ID++;
    }

}