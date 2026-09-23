import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class DomainService {

  constructor() { }

  private selectedDomain: string;

  setSelected(name: string): void {
    this.selectedDomain = name;
  }

  getSelected(): string {
    return this.selectedDomain;
  }
}
