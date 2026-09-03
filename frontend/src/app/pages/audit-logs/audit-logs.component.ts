import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OperationsService } from '../../core/operations.service';
import { ToastService } from '../../core/toast.service';
import { AuditLogEntry } from '../../core/models';
import { extractErrorMessage } from '../../core/api';
import { PanelComponent } from '../../components/panel/panel.component';

@Component({
  selector: 'app-audit-logs',
  standalone: true,
  imports: [CommonModule, FormsModule, PanelComponent],
  templateUrl: './audit-logs.component.html',
  styleUrl: './audit-logs.component.css'
})
export class AuditLogsComponent implements OnInit {
  private readonly operations = inject(OperationsService);
  private readonly toast = inject(ToastService);

  protected items: AuditLogEntry[] = [];
  protected action = '';
  protected result = '';
  protected startDate = '';
  protected endDate = '';
  protected page = 1;
  protected pageSize = 20;
  protected total = 0;
  protected loading = false;

  ngOnInit(): void {
    this.load();
  }

  load(page = this.page): void {
    this.loading = true;
    this.page = page;
    const params: Record<string, string | number> = {
      page: this.page,
      pageSize: this.pageSize,
    };
    if (this.action) params['action'] = this.action;
    if (this.result) params['result'] = this.result;
    if (this.startDate) params['startDate'] = this.startDate;
    if (this.endDate) params['endDate'] = this.endDate;

    this.operations.getAuditLogs(params).subscribe({
      next: (response) => {
        this.items = response.items;
        this.total = response.total;
        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        this.toast.error(extractErrorMessage(error, 'Unable to load audit logs.'));
      },
    });
  }

  downloadCsv(): void {
    const params: Record<string, string> = {};
    if (this.action) params['action'] = this.action;
    if (this.result) params['result'] = this.result;
    if (this.startDate) params['startDate'] = this.startDate;
    if (this.endDate) params['endDate'] = this.endDate;

    this.operations.downloadAuditCsv(params).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'audit-logs.csv';
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error) => this.toast.error(extractErrorMessage(error, 'Unable to export audit logs.')),
    });
  }
}
