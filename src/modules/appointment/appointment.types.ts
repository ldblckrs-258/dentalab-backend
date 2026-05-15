export interface AppointmentCreatedEvent {
  id: string;
  providerId: string;
  startTime: string;
  endTime: string;
}

export interface AppointmentUpdatedEvent {
  id: string;
  providerId: string;
  startTime: string;
  endTime: string;
  previousProviderId?: string;
}

export interface AppointmentCancelledEvent {
  id: string;
  providerId: string;
}
