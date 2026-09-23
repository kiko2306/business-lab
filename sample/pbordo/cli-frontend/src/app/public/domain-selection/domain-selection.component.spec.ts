import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { DomainSelectionComponent } from './domain-selection.component';

describe('DomainSelectionComponent', () => {
  let component: DomainSelectionComponent;
  let fixture: ComponentFixture<DomainSelectionComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ DomainSelectionComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(DomainSelectionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
