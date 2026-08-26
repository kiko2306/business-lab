# Development Guide

## Local development

Backend:
```bash
cd backend
npm install
npm run dev
```

Frontend:
```bash
cd frontend
npm install
npm start
```

## Build validation

- Frontend build: `cd frontend && npm run build`
- Backend type check: `cd backend && npm run typecheck`
- Backend build: `cd backend && npm run build` (compiles TypeScript to `backend/dist`)

## Smoke validation

Run against local backend:
```bash
./scripts/smoke-tests.sh
```
