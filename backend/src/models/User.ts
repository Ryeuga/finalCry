import mongoose, { Schema } from 'mongoose';

interface IUser extends Document {
  name: string;
  email: string;
  socketId?: string;
  isVerified: boolean;
  isBanned: boolean;
  college?: string;
  createdAt: Date;
  updatedAt: Date;
  friends: string[];
  friendRequests: string[];
}

const UserSchema = new Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  socketId: { type: String },
  isVerified: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  college: { type: String },
  friends: [{ type: String }],
  friendRequests: [{ type: String }]
}, {
  timestamps: true,
});

// If you previously had both field-level unique and schema.index({ email: 1 }, { unique: true }), remove the schema.index version.
// Example: remove or comment out the next line if present:
// UserSchema.index({ email: 1 }, { unique: true });

export default mongoose.model('User', UserSchema);

