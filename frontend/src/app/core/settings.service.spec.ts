import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { SettingsService } from './settings.service';
import { API_BASE_URL } from './api';
import { SKIP_GLOBAL_ERROR_HANDLING } from './http-context';

// plan.md §796: getBackupTarget/saveBackupTarget/testBackupTarget/getKopiaStatus
// and getMailSettings/saveMailSettings/testMailSettings never set the flag —
// their callers show their own inline feedback (backupTargetFeedback,
// mailFeedback), so a failure there showed that inline message *and* the
// interceptor's generic toast stacked on top (the §794.1 double-toast bug's
// toast+inline sibling, left deferred at the time). Every other method in
// this file already sets the flag; this table guards all of them so a new or
// edited method can't lose it silently.
describe('SettingsService request contexts skip the global error toast', () => {
  let service: SettingsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(SettingsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const cases: { name: string; url: string; call: () => void }[] = [
    { name: 'loadCloudflareSettings', url: `${API_BASE_URL}/settings/cloudflare-token`, call: () => service.loadCloudflareSettings().subscribe() },
    { name: 'saveCloudflareToken', url: `${API_BASE_URL}/settings/cloudflare-token`, call: () => service.saveCloudflareToken('t').subscribe() },
    {
      name: 'saveCloudflareAccountModel',
      url: `${API_BASE_URL}/settings/cloudflare-account-model`,
      call: () => service.saveCloudflareAccountModel('self-controlled').subscribe(),
    },
    { name: 'testCloudflareToken', url: `${API_BASE_URL}/settings/cloudflare-token/test`, call: () => service.testCloudflareToken().subscribe() },
    { name: 'loadExposureSettings', url: `${API_BASE_URL}/settings/exposure`, call: () => service.loadExposureSettings().subscribe() },
    { name: 'getBackupTarget', url: `${API_BASE_URL}/settings/backup-target`, call: () => service.getBackupTarget().subscribe() },
    {
      name: 'saveBackupTarget',
      url: `${API_BASE_URL}/settings/backup-target`,
      call: () => service.saveBackupTarget({ kind: 'disk', path: '/data' }).subscribe(),
    },
    { name: 'testBackupTarget', url: `${API_BASE_URL}/settings/backup-target/test`, call: () => service.testBackupTarget().subscribe() },
    { name: 'getKopiaStatus', url: `${API_BASE_URL}/settings/backup-target/kopia-status`, call: () => service.getKopiaStatus().subscribe() },
    { name: 'loadAiKeys', url: `${API_BASE_URL}/settings/ai-keys`, call: () => service.loadAiKeys().subscribe() },
    { name: 'saveAiKey', url: `${API_BASE_URL}/settings/ai-keys/anthropic`, call: () => service.saveAiKey('anthropic', 'k').subscribe() },
    { name: 'testAiKey', url: `${API_BASE_URL}/settings/ai-keys/anthropic/test`, call: () => service.testAiKey('anthropic', 'k').subscribe() },
    {
      name: 'saveAiFeatureProvider',
      url: `${API_BASE_URL}/settings/ai-feature-provider`,
      call: () => service.saveAiFeatureProvider('social_generate', 'anthropic').subscribe(),
    },
    { name: 'getMailSettings', url: `${API_BASE_URL}/settings/mail`, call: () => service.getMailSettings().subscribe() },
    {
      name: 'saveMailSettings',
      url: `${API_BASE_URL}/settings/mail`,
      call: () =>
        service
          .saveMailSettings({ smtpHost: 'h', smtpPort: 587, smtpUser: 'u', smtpEncryption: 'tls', fromAddress: 'a@b.com' })
          .subscribe(),
    },
    { name: 'testMailSettings', url: `${API_BASE_URL}/settings/mail/test`, call: () => service.testMailSettings().subscribe() },
    {
      name: 'saveExposureSettings',
      url: `${API_BASE_URL}/settings/exposure`,
      call: () =>
        service
          .saveExposureSettings({ baseDomain: 'd', npmEmail: 'a@b.com', cloudflareTunnelId: 't' })
          .subscribe(),
    },
    { name: 'testExposureConnection', url: `${API_BASE_URL}/settings/exposure/test`, call: () => service.testExposureConnection().subscribe() },
    { name: 'loadDeploymentStatus', url: `${API_BASE_URL}/settings/deployment`, call: () => service.loadDeploymentStatus().subscribe() },
    { name: 'loadGeneralSettings', url: `${API_BASE_URL}/settings/general`, call: () => service.loadGeneralSettings().subscribe() },
    { name: 'saveGeneralSettings', url: `${API_BASE_URL}/settings/general`, call: () => service.saveGeneralSettings('UTC').subscribe() },
    { name: 'loadAlertSettings', url: `${API_BASE_URL}/settings/alerts`, call: () => service.loadAlertSettings().subscribe() },
    { name: 'saveAlertSettings', url: `${API_BASE_URL}/settings/alerts`, call: () => service.saveAlertSettings({}).subscribe() },
    { name: 'loadCrowdsecBans', url: `${API_BASE_URL}/settings/crowdsec/bans`, call: () => service.loadCrowdsecBans().subscribe() },
    { name: 'unbanCrowdsecIp', url: `${API_BASE_URL}/settings/crowdsec/bans?ip=1.2.3.4`, call: () => service.unbanCrowdsecIp('1.2.3.4').subscribe() },
    { name: 'testAlertSource', url: `${API_BASE_URL}/settings/alerts/test`, call: () => service.testAlertSource('ntfy').subscribe() },
  ];

  for (const { name, url, call } of cases) {
    it(`${name} sets SKIP_GLOBAL_ERROR_HANDLING`, () => {
      call();
      const req = httpMock.expectOne(url);
      expect(req.request.context.get(SKIP_GLOBAL_ERROR_HANDLING)).withContext(name).toBeTrue();
      req.flush({});
    });
  }
});
