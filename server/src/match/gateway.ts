/**
 * gateway.ts — Autentica a conexão Socket.IO (mesmo access token do REST) e
 * roteia os eventos de partida para a MatchRoom correspondente ao socket.
 */
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { eq } from 'drizzle-orm';
import { verifyAccessToken } from '../auth/tokens.js';
import { db } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { RoomRegistry } from './RoomRegistry.js';
import type { UnitKey } from '../../../shared/types.js';

interface SocketData {
  userId: string;
  displayName: string;
  trophies: number;
  roomCode: string | null;
}

export function registerMatchGateway(io: SocketIOServer): void {
  io.use((socket, next) => {
    void (async () => {
      try {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) throw new Error('sem token');
        const payload = verifyAccessToken(token);
        const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, payload.sub) });
        if (!profile) throw new Error('perfil não encontrado');
        socket.data = {
          userId: profile.userId,
          displayName: profile.displayName,
          trophies: profile.trophies,
          roomCode: null,
        } as SocketData;
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    })();
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;

    socket.on('room:join', ({ roomCode }: { roomCode: string }) => {
      const room = RoomRegistry.getOrCreate(roomCode);
      const ok = room.join(socket, {
        userId: data.userId,
        displayName: data.displayName,
        trophies: data.trophies,
      });
      if (ok) data.roomCode = roomCode;
    });

    socket.on('deploy:request', ({ key, lane }: { key: UnitKey; lane: number }) => {
      if (!data.roomCode) return;
      RoomRegistry.get(data.roomCode)?.handleDeploy(socket, key, lane);
    });

    socket.on('match:forfeit', () => {
      if (!data.roomCode) return;
      RoomRegistry.get(data.roomCode)?.handleForfeit(socket);
    });

    socket.on('disconnect', () => {
      if (!data.roomCode) return;
      RoomRegistry.get(data.roomCode)?.handleDisconnect(socket);
    });
  });
}
