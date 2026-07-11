import { MemoryGovernanceRecord, MemoryRecord, UUID } from "../types";
import { MemoryRepository } from "./MemoryRepository";

/**
 * Read-only orchestration boundary over MemoryRepository — "what does
 * the system currently know about this user, and why". Nothing outside
 * this service (and MemoryGovernanceService, for writes) should call
 * MemoryRepository directly. DigitalTwinService calls
 * getMemoryMap()/getKnownMemories() rather than reaching past this
 * service into MemoryRepository itself.
 */
export class MemoryMapService {
  constructor(private readonly repository: MemoryRepository) {}

  /** Every memory HadeelOS has ever formed for this user, regardless of state or blocked flag. */
  async getMemoryMap(userId: UUID): Promise<MemoryRecord[]> {
    return this.repository.getAllForUser(userId);
  }

  /**
   * Only the memories that are safe to act on: state "Knows" and not
   * blocked. This is what DigitalTwinService should prefer as its
   * memory input, though TwinDerivationPolicy re-applies the same
   * filter defensively regardless of what it's given.
   */
  async getKnownMemories(userId: UUID): Promise<MemoryRecord[]> {
    const all = await this.repository.getAllForUser(userId);
    return all.filter((memory) => memory.state === "Knows" && !memory.blocked);
  }

  async get(id: UUID): Promise<MemoryRecord | undefined> {
    return this.repository.get(id);
  }

  async getByKey(userId: UUID, key: string): Promise<MemoryRecord | undefined> {
    return this.repository.getByKey(userId, key);
  }

  async getGovernanceLog(memoryId: UUID): Promise<MemoryGovernanceRecord[]> {
    return this.repository.getGovernanceLog(memoryId);
  }
}
