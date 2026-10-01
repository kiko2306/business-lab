import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { OperationsService } from './operations.service';
import { API_BASE_URL } from './api';
import { SKIP_GLOBAL_ERROR_HANDLING } from './http-context';

// plan.md §794.1: a failed request could show two error toasts — the global
// interceptor's generic one, and the calling component's own more specific
// one — because the request's HttpContext never told the interceptor to
// stand down. Fixed on every method below; this guards against a new or
// edited method losing the flag silently (no other symptom would show up
// until someone hit the exact failure live, the way this bug was found).
describe('OperationsService request contexts skip the global error toast', () => {
  let service: OperationsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(OperationsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const cases: { name: string; url: string; call: () => void }[] = [
    { name: 'getAuditLogs', url: `${API_BASE_URL}/audit-logs`, call: () => service.getAuditLogs({}).subscribe() },
    { name: 'downloadAuditCsv', url: `${API_BASE_URL}/audit-logs/export.csv`, call: () => service.downloadAuditCsv({}).subscribe() },
    { name: 'listBackups', url: `${API_BASE_URL}/backups`, call: () => service.listBackups().subscribe() },
    { name: 'createBackup', url: `${API_BASE_URL}/backups/create`, call: () => service.createBackup().subscribe() },
    { name: 'restoreBackup', url: `${API_BASE_URL}/backups/restore`, call: () => service.restoreBackup('f').subscribe() },
    { name: 'downloadBackup', url: `${API_BASE_URL}/backups/download/f`, call: () => service.downloadBackup('f').subscribe() },
    { name: 'getBackupSchedule', url: `${API_BASE_URL}/backups/schedule`, call: () => service.getBackupSchedule().subscribe() },
    {
      name: 'updateBackupSchedule',
      url: `${API_BASE_URL}/backups/schedule`,
      call: () => service.updateBackupSchedule({ enabled: true, frequency: 'daily', runAtTime: '03:00', retentionCount: 7 }).subscribe(),
    },
    { name: 'checkForSelfUpdate', url: `${API_BASE_URL}/self-update/check`, call: () => service.checkForSelfUpdate().subscribe() },
    { name: 'triggerSelfUpdate', url: `${API_BASE_URL}/self-update/trigger`, call: () => service.triggerSelfUpdate().subscribe() },
    { name: 'listAppBackups', url: `${API_BASE_URL}/services/paperless/backups`, call: () => service.listAppBackups('paperless').subscribe() },
    { name: 'createAppBackup', url: `${API_BASE_URL}/services/paperless/backup`, call: () => service.createAppBackup('paperless').subscribe() },
    {
      name: 'restoreAppBackup',
      url: `${API_BASE_URL}/services/paperless/backup/restore`,
      call: () => service.restoreAppBackup('paperless', 'f').subscribe(),
    },
    { name: 'deleteAppBackup', url: `${API_BASE_URL}/services/paperless/backups/f`, call: () => service.deleteAppBackup('paperless', 'f').subscribe() },
    { name: 'downloadAppBackup', url: `${API_BASE_URL}/services/paperless/backups/f`, call: () => service.downloadAppBackup('paperless', 'f').subscribe() },
    { name: 'getServiceEnv', url: `${API_BASE_URL}/services/paperless/env`, call: () => service.getServiceEnv('paperless').subscribe() },
    {
      name: 'updateServiceEnv',
      url: `${API_BASE_URL}/services/paperless/env`,
      call: () => service.updateServiceEnv('paperless', {}).subscribe(),
    },
    { name: 'getAutheliaAdminUser', url: `${API_BASE_URL}/services/paperless/admin-user`, call: () => service.getAutheliaAdminUser('paperless').subscribe() },
    {
      name: 'updateAutheliaAdminUser',
      url: `${API_BASE_URL}/services/paperless/admin-user`,
      call: () => service.updateAutheliaAdminUser('paperless', { username: 'a', displayName: 'a', email: 'a@b.com' }).subscribe(),
    },
    { name: 'scanNetwork', url: `${API_BASE_URL}/network/scan`, call: () => service.scanNetwork().subscribe() },
    { name: 'listUsers', url: `${API_BASE_URL}/users`, call: () => service.listUsers().subscribe() },
    { name: 'createUser', url: `${API_BASE_URL}/users`, call: () => service.createUser('u', 'u@example.com', ['admin']).subscribe() },
    { name: 'resendInvite', url: `${API_BASE_URL}/users/1/invitation/resend`, call: () => service.resendInvite(1).subscribe() },
    { name: 'updateUserAccess', url: `${API_BASE_URL}/users/1/access`, call: () => service.updateUserAccess(1, 'u@example.com', []).subscribe() },
    { name: 'updateUserRoles', url: `${API_BASE_URL}/users/1/roles`, call: () => service.updateUserRoles(1, ['admin']).subscribe() },
    { name: 'updateUserCapabilities', url: `${API_BASE_URL}/users/1/capabilities`, call: () => service.updateUserCapabilities(1, []).subscribe() },
    { name: 'updateUserPassword', url: `${API_BASE_URL}/users/1/password`, call: () => service.updateUserPassword(1, 'x').subscribe() },
    { name: 'deleteUser', url: `${API_BASE_URL}/users/1`, call: () => service.deleteUser(1).subscribe() },
  ];

  const blobResponse = new Set(['downloadAuditCsv', 'downloadBackup', 'downloadAppBackup']);

  for (const { name, url, call } of cases) {
    it(`${name} sets SKIP_GLOBAL_ERROR_HANDLING`, () => {
      call();
      const req = httpMock.expectOne(url);
      expect(req.request.context.get(SKIP_GLOBAL_ERROR_HANDLING)).withContext(name).toBeTrue();
      req.flush(blobResponse.has(name) ? new Blob(['x']) : {});
    });
  }
});
