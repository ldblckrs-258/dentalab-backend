import { Test, TestingModule } from '@nestjs/testing';
import {
  ClinicalNoteController,
  PatientClinicalNoteController,
  AppointmentClinicalNoteController,
} from './clinical-note.controller';
import { RagService } from '@modules/rag/rag.service';
import { ClinicalNoteService } from './clinical-note.service';
import type { CreateClinicalNoteDto } from './dto/create-clinical-note.dto';
import type { UpdateClinicalNoteDto } from './dto/update-clinical-note.dto';
import type { CreateAddendumDto } from './dto/create-addendum.dto';

const mockService = {
  findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  findById: jest.fn().mockResolvedValue({ id: 'note-1', status: 'draft' }),
  findByPatient: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  findByAppointment: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  create: jest.fn().mockResolvedValue({ id: 'note-1', status: 'draft' }),
  update: jest.fn().mockResolvedValue({ id: 'note-1', status: 'draft' }),
  sign: jest.fn().mockResolvedValue({ id: 'note-1', status: 'signed' }),
  createAddendum: jest.fn().mockResolvedValue({ id: 'note-2', version: 2 }),
  softDelete: jest.fn().mockResolvedValue({ id: 'note-1' }),
};

const mockRagService = {
  getClinicalNoteRagStatus: jest
    .fn()
    .mockResolvedValue({ id: 'rag-1', status: 'completed' }),
};

describe('ClinicalNoteController', () => {
  let controller: ClinicalNoteController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClinicalNoteController],
      providers: [
        { provide: ClinicalNoteService, useValue: mockService },
        { provide: RagService, useValue: mockRagService },
      ],
    }).compile();

    controller = module.get(ClinicalNoteController);
    jest.clearAllMocks();
  });

  it('findAll delegates to service.findAll', async () => {
    await controller.findAll({});
    expect(mockService.findAll).toHaveBeenCalledWith({});
  });

  it('findById delegates to service.findById without addendums by default', async () => {
    await controller.findById('note-1', undefined);
    expect(mockService.findById).toHaveBeenCalledWith('note-1', false);
  });

  it('findById passes includeAddendums=true when query param is "true"', async () => {
    await controller.findById('note-1', 'true');
    expect(mockService.findById).toHaveBeenCalledWith('note-1', true);
  });

  it('create delegates to service.create', async () => {
    const dto = {
      patientId: 'patient-1',
      subjective: 'Pain',
    } as CreateClinicalNoteDto;
    await controller.create(dto);
    expect(mockService.create).toHaveBeenCalledWith(dto);
  });

  it('update delegates to service.update', async () => {
    const dto = { subjective: 'Updated' } as UpdateClinicalNoteDto;
    await controller.update('note-1', dto);
    expect(mockService.update).toHaveBeenCalledWith('note-1', dto);
  });

  it('sign delegates to service.sign', async () => {
    await controller.sign('note-1', {});
    expect(mockService.sign).toHaveBeenCalledWith('note-1');
  });

  it('createAddendum delegates to service.createAddendum', async () => {
    const dto = { subjective: 'Addendum' } as CreateAddendumDto;
    await controller.createAddendum('note-1', dto);
    expect(mockService.createAddendum).toHaveBeenCalledWith('note-1', dto);
  });

  it('softDelete delegates to service.softDelete', async () => {
    await controller.softDelete('note-1');
    expect(mockService.softDelete).toHaveBeenCalledWith('note-1');
  });
});

describe('PatientClinicalNoteController', () => {
  let controller: PatientClinicalNoteController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PatientClinicalNoteController],
      providers: [{ provide: ClinicalNoteService, useValue: mockService }],
    }).compile();

    controller = module.get(PatientClinicalNoteController);
    jest.clearAllMocks();
  });

  it('findByPatient delegates to service.findByPatient', async () => {
    await controller.findByPatient('patient-1', {});
    expect(mockService.findByPatient).toHaveBeenCalledWith('patient-1', {});
  });
});

describe('AppointmentClinicalNoteController', () => {
  let controller: AppointmentClinicalNoteController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppointmentClinicalNoteController],
      providers: [{ provide: ClinicalNoteService, useValue: mockService }],
    }).compile();

    controller = module.get(AppointmentClinicalNoteController);
    jest.clearAllMocks();
  });

  it('findByAppointment delegates to service.findByAppointment', async () => {
    await controller.findByAppointment('appt-1', {});
    expect(mockService.findByAppointment).toHaveBeenCalledWith('appt-1', {});
  });
});
