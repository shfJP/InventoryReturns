export class ReftabWriteError extends Error {
  constructor(message: string, public readonly outcome: "rejected" | "uncertain" | "partial") {
    super(message);
    this.name = "ReftabWriteError";
  }
}
