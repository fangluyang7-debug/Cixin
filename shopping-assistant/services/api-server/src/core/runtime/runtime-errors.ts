export class RuntimePlanningError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimePlanningError";
  }
}
