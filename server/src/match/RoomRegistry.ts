/** RoomRegistry.ts — registro em memória das salas ativas (single-instance, Fase 0/1). */
import { MatchRoom } from './MatchRoom.js';

class RoomRegistryImpl {
  private rooms = new Map<string, MatchRoom>();

  getOrCreate(roomCode: string): MatchRoom {
    let room = this.rooms.get(roomCode);
    if (!room) {
      room = new MatchRoom(roomCode, (r) => this.rooms.delete(r.roomCode));
      this.rooms.set(roomCode, room);
    }
    return room;
  }

  get(roomCode: string): MatchRoom | undefined {
    return this.rooms.get(roomCode);
  }
}

export const RoomRegistry = new RoomRegistryImpl();
