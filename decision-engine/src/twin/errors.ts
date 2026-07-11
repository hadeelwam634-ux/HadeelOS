import { UUID } from "../types";

/** Base class for every error this module throws. */
export class DigitalTwinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DigitalTwinError";
  }
}

export class DuplicateDigitalTwinSnapshotError extends DigitalTwinError {
  constructor(id: UUID) {
    super(`DigitalTwinSnapshot with id "${id}" already exists.`);
    this.name = "DuplicateDigitalTwinSnapshotError";
  }
}

export class UnknownDigitalTwinSnapshotError extends DigitalTwinError {
  constructor(id: UUID) {
    super(`DigitalTwinSnapshot with id "${id}" does not exist.`);
    this.name = "UnknownDigitalTwinSnapshotError";
  }
}
