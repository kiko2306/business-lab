import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { CliLoginComponent } from './cli-login.component';

describe('CliLoginComponent', () => {
  let component: CliLoginComponent;
  let fixture: ComponentFixture<CliLoginComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ CliLoginComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(CliLoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
