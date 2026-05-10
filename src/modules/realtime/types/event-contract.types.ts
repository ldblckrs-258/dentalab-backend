export type EventName<TEvents> = keyof TEvents & string;

export type EventPayload<TEvents, K extends EventName<TEvents>> = TEvents[K];
