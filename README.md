# Ticketing System API

Backend API for a ticketing system with blockchain revocation capabilities.

## Features

- User management with verification workflow
- Event management
- Ticket creation and validation
- Payment processing
- Admin authentication and authorization
- Blockchain ticket revocation (placeholder)

## Tech Stack

- Vercel Serverless Functions
- Supabase (Database & Authentication)
- Node.js

## Environment Variables

Create a `.env.local` file with the following variables:
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key
## API Endpoints

### Users
- `POST /api/users/register` - Register new user
- `POST /api/users/login` - User login
- `GET /api/users/get` - Get user details
- `PUT /api/users/update` - Update user details
- `POST /api/users/verify` - Verify user (admin only)
- `GET /api/users/check-verification` - Check verification status
- `GET /api/users/list` - List users (admin only)

### Events
- `POST /api/events/create` - Create event (admin only)
- `PUT /api/events/update` - Update event (admin only)
- `DELETE /api/events/delete` - Delete event (admin only)
- `GET /api/events/list` - List all events
- `GET /api/events/get` - Get event details

### Tickets
- `POST /api/tickets/create` - Create tickets (admin only)
- `POST /api/tickets/validate` - Validate ticket (admin only)
- `POST /api/tickets/revoke` - Revoke ticket (admin only)

### Payments
- `POST /api/payments/verify` - Verify payment (admin only)

## Development

1. Install dependencies:
```bash
npm install

2. Run locally
'''bash
npm run dev

3. Deploy to Vercel
'''bash
npm run deploy