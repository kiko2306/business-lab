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
- Backend syntax check: `node --check backend/src/index.js`

## Smoke validation

Run against local backend:
```bash
./scripts/smoke-tests.sh
```
