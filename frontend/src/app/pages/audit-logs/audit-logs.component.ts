import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OperationsService } from '../../core/operations.service';
import { ToastService } from '../../core/toast.service';
import { AuditLogEntry } from '../../core/models';
import { extractErrorMessage } from '../../core/api';
import { PanelComponent } from '../../components/panel/panel.component';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { TranslateService } from '../../i18n/translate.service';

@Component({
    selector: 'app-audit-logs',
    imports: [CommonModule, FormsModule, PanelComponent, TranslatePipe],
    templateUrl: './audit-logs.component.html',
    styleUrl: './audit-logs.component.css'
})
export class AuditLogsComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly toast = inject(ToastService);
  protected readonly translate = inject(TranslateService);

  protected items: AuditLogEntry[] = [];
  protected action = '';
  protected result = '';
  protected startDate = '';
  protected endDate = '';
  protected page = 1;
  protected pageSize = 20;
  protected total = 0;
  protected loading = false;
  protected failed = false;
  protected readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  protected get rangeFrom(): number {
    return (this.page - 1) * this.pageSize + 1;
  }

  protected get rangeTo(): number {
    return this.rangeFrom + this.items.length - 1;
  }

  ngOnInit(): void {
    this.load();
  }

  load(page = this.page): void {
    this.loading = true;
    this.failed = false;
    this.page = page;
    const params: Record<string, string | number> = {
      page: this.page,
      pageSize: this.pageSize,
    };
    if (this.action) params['action'] = this.action;
    if (this.result) params['result'] = this.result;
    // A datetime-local value has no zone; sent bare it was read in the server's, while the table shows the reader's.
    if (this.startDate) params['startDate'] = new Date(this.startDate).toISOString();
    if (this.endDate) params['endDate'] = new Date(this.endDate).toISOString();

    this.operations.getAuditLogs(params).subscribe({
      next: (response) => {
        this.items = response.items;
        this.total = response.total;
        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        // An inline alert with Retry, not a toast: server text is English and a failed load must not read as an empty log.
        this.failed = true;
      },
    });
  }

  protected get filtered(): boolean {
    return !!(this.action || this.result || this.startDate || this.endDate);
  }

  protected clearFilters(): void {
    this.action = this.result = this.startDate = this.endDate = '';
    this.load(1);
  }

  // The CSV keeps the raw code; the table shows a sentence, and an unknown code shows as itself.
  protected actionText(code: string): string {
    const key = `auditLogs.action.${code}`;
    const text = this.translate.t(key);
    return text === key ? code : text;
  }

  protected resultText(result: string): string {
    const key = `auditLogs.result.${result}`;
    const text = this.translate.t(key);
    return text === key ? result : text;
  }

  downloadCsv(): void {
    const params: Record<string, string> = {};
    if (this.action) params['action'] = this.action;
    if (this.result) params['result'] = this.result;
    if (this.startDate) params['startDate'] = new Date(this.startDate).toISOString();
    if (this.endDate) params['endDate'] = new Date(this.endDate).toISOString();

    this.operations.downloadAuditCsv(params).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'audit-logs.csv';
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error) => this.toast.error(extractErrorMessage(error, this.translate.t('auditLogs.errors.export'))),
    });
  }
}
