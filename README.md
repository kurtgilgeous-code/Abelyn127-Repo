# Tampisawan Booking

React + TypeScript customer website and an Express API with PostgreSQL-backed customer and admin accounts.

## Configure PostgreSQL

Create a PostgreSQL database named `tampisawan`, then add its connection string to the project-root `.env` file:

```env
DATABASE_URL=postgresql://your_user:your_password@localhost:5432/tampisawan
```

Keep the connection string private. The API creates the `users` and `bookings` tables when first needed.

## Create the admin account

Install dependencies once:

```powershell
npm.cmd install
npm.cmd --prefix server install
```

Provision or reset an admin account. The password is entered without echo and stored as a bcrypt hash in PostgreSQL. The command also creates a JWT signing secret in the ignored root `.env` file:

```powershell
npm.cmd --prefix server run admin:create
```

Use an admin username with 3–32 lowercase letters, numbers, dots, underscores, or hyphens, and a password of at least 12 characters. Start both apps:

```powershell
npm.cmd run dev
```

Open the Local URL printed by Vite. Everyone signs in at `/login`; successful admin sign-in redirects to `/admin/dashboard` and customer sign-in redirects to `/customer/booking`.

The older prototype stored its admin password hash in `.env`. The PostgreSQL-based login does not authenticate from that legacy hash; run `admin:create` to provision the admin account in the database.

## Customer account registration

On `/login`, choose **Create your account**. Customers provide a name, email, username, and password. Passwords must be at least 12 characters (maximum 72 UTF-8 bytes). The server hashes passwords with bcrypt before storing them. Registration always assigns `CUSTOMER`; only the separate admin setup command can create an `ADMIN`.

## Booking rate calculation

The customer selects Overnight (2:00 PM–12:00 NN), Day Tour (7:00 AM–5:00 PM), or Night Tour (7:00 PM–6:00 AM), then chooses an accommodation and date range. Checkout is the exclusive end date, so the date difference is the number of booked days. Poster accommodation rates are charged per day: Abelyn's Cabin Glass ₱6,000; Bahay Hapag ₱2,500; Balai Delnor ₱6,500; Gazebo ₱1,000; Balay Buknoy ₱4,000; Abelyn's Mini Event Area ₱2,500; Balai Andeng ₱1,200; Calesa Tables ₱500; Kubo ni Gerrant ₱1,000. Applicable entrance fees are charged for each day: Day Tour adult ₱150 and senior/PWD/child ₱120; Night Tour adult ₱250 and senior/PWD/child ₱150. Overnight uses the Night Tour entrance-fee rates. Capacity is included before entrance fees apply, counting adults first, then seniors/PWD, then children; Gazebo, Calesa Tables, and Kubo ni Gerrant charge entrance fees for all guests. For example, a three-day Bahay Hapag stay is ₱7,500 before entrance fees.

## Authentication and authorization

The API exposes `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, and `GET /api/admin/me`. Login accepts a username or email. Signed JWT access tokens expire after eight hours and are held in browser session storage; signing out removes the token from that browser. The API verifies the token and role for protected admin routes. Login and registration requests are rate limited.

For production, use HTTPS, protect `DATABASE_URL` and `JWT_SECRET`, set `APP_ORIGIN` to the exact public site origin, and configure database backups and monitoring. Anyone with database access can change account roles; restrict that access.

## Deploy to Render

The root `render.yaml` defines one Node web service that builds and serves both the React app and Express API, a managed PostgreSQL database, and a persistent disk for private payment screenshots. The service and database are configured for Render's Singapore region. Render persistent disks require a paid web-service plan and keep the service to one instance; review current Render plan pricing and database backup settings before launch.

1. Push this project to a private GitHub repository, create or sign in to Render, and use **New > Blueprint** to connect the repository and apply `render.yaml`. The blueprint generates `JWT_SECRET` and connects the managed database automatically. Keep repository access restricted.
2. Wait for the first successful deploy and confirm `/api/health` reports `status: "ok"` and `databaseConnected: true`.
3. In the Render service Shell, run `node server/dist/createAdmin.js` to create the first admin. Use a unique admin username and a strong password; do not make a customer account an admin.
4. Sign in at `/login?next=admin`, test customer registration and booking/payment review end-to-end, and verify that an uploaded proof remains available after a redeploy.
5. Before sharing the site, set `APP_ORIGIN` to the exact HTTPS origin if using a custom domain, configure that domain in Render, and test sign-in, booking, proof upload/viewing, and payment verification again.

The initial persistent disk is 1 GB: monitor its usage and arrange retention/deletion rules for old proofs before it fills. Do not remove or detach it without backing up required payment records. Database data and local payment proofs are separate; back up both. Existing local development accounts, bookings, and proofs are not automatically copied to Render. The database uses the schema migration in the server; provisioning the first admin runs it.

## Booking and payment review

Bookings and payment history are stored in PostgreSQL and are visible to the owning customer and authorized admins. Before an inquiry is sent, the customer must choose a 50% downpayment or full payment, provide the transaction reference and the payer account name/number used for the transfer, and attach a PNG, JPEG, or WebP transaction screenshot. The account details are for transfer identification only; customers must never provide a PIN, password, or OTP. The inquiry remains pending until an admin checks the transaction and confirms receipt. Customers can open **My bookings & payments** in the top navigation, choose **Pay early** on a booking with a verified downpayment, enter any amount up to the remaining balance, and submit the payment reference, payer account details, and screenshot for admin review. The remaining balance is due at least one hour before the selected tour's checkout time: 11:00 AM for Overnight, 4:00 PM for Day Tour, and 5:00 AM for Night Tour. Verified full payment completes the booking. Admins may also record cash they received directly. The customer account shows each payment and whether it is awaiting review, approved, or not received; when open, the account checks for approval updates every 15 seconds. If the payment was received but another verified booking secured those dates first, the customer sees a Facebook contact link for refund follow-up or alternatives. A submitted payment reference or screenshot does not itself confirm that money was received; check the actual payment account.

The admin dashboard groups bookings into **All Inquiries**, **DownPayments**, and **Full Payment** tabs. **All Inquiries** contains only bookings still pending review. Downpayment subtabs track pending, successful, cancelled, not-received, still-balanced, fully paid, and pending early-payment cases. Full-payment subtabs track pending, confirmed, and cancelled/not-received cases. Counts are based on the original payment amount and the payment-history review results; each booking card displays its transaction proofs.

An admin's payment-received verification secures the accommodation and date interval if no earlier-verified confirmed booking overlaps it. Conflicting approvals are serialized per accommodation. If a transfer was actually received after those dates were secured, the payment is recorded as received, the booking is marked date unavailable, and the admin/customer are prompted to arrange follow-up rather than the system pretending the transfer was rejected. Tour times are shown on each booking; the checkout date is exclusive and is not billed as an additional day. Different accommodations are checked independently.

Payment screenshots are stored privately under `server/storage/payment-proofs/` for local development. In the Render deployment they are written to the configured persistent disk and served only through the admin-authorized API. For other hosting providers, configure durable private storage; never use an ephemeral filesystem for payment proofs. Use HTTPS, access controls, retention policies, and backups. This app records manually verified payments; it does not process payments directly or replace a payment processor.

## Other commands

- `npm.cmd run build` — build the customer frontend.
- `npm.cmd run build:server` — compile the API.
- `npm.cmd run lint` — lint the frontend.

Rates and entrance-fee capacity assumptions are documented on the customer page; confirm them with Tampisawan before enabling real bookings.
