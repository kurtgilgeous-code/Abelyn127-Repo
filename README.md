# Tampisawan Booking

React + TypeScript customer website with an Express/PostgreSQL local backend and a Cloudflare Workers production option using D1 and private R2 object storage.

## Configure PostgreSQL

For local development with the Express API, create a PostgreSQL database named `tampisawan`, then add its connection string to the project-root `.env` file:

```env
DATABASE_URL=postgresql://your_user:your_password@localhost:5432/tampisawan
```

Keep the connection string private. The local API creates the `users`, `bookings`, and payment tables when first needed.

## Create the local PostgreSQL admin account

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

Open the Local URL printed by Vite; the home page and `/login` both show the sign-in page. Guests can browse the public `/preview` page, check confirmed-date overlaps, and estimate rates without an account. Choosing **Sign In to Book** saves their selections and returns them to the booking form after customer login or registration. Successful admin sign-in redirects to `/admin/dashboard` and customer sign-in redirects to `/customer/booking`.

The older prototype stored its admin password hash in `.env`. The PostgreSQL-based login does not authenticate from that legacy hash; run `admin:create` to provision the admin account in the database.

## Customer account registration

On `/login`, choose **Create your account**. Customers provide a name, email, username, and password. Passwords must be at least 12 characters (maximum 72 UTF-8 bytes). The server hashes passwords with bcrypt before storing them. Registration always assigns `CUSTOMER`; only the separate admin setup command can create an `ADMIN`.

## Deploy to Cloudflare Workers

The Cloudflare deployment serves the built React app and API from one Worker. D1 stores customer accounts, bookings, and payment history; the R2 bucket stores private payment screenshots. No customer or booking data is copied from local PostgreSQL: this deployment starts with a new, empty database.

1. Sign in to Cloudflare and authenticate Wrangler with `npx wrangler login`.
2. The `tampisawan-booking` D1 database is configured in `wrangler.jsonc`. Enable R2 in the Cloudflare dashboard, then create the private bucket with `npm run cloudflare:r2:create`.
3. Apply any pending D1 schema migrations with `npm run cloudflare:db:migrate:remote`. This includes the payment hierarchy fields in migration `0002`, the HitPay gateway column rename in `0003`, the walk-in vouchers in `0004`, multi-accommodation bookings in `0005`, and safe user removal plus blocked dates in `0006`.
4. Set production secrets with `npx wrangler secret put JWT_SECRET`, `npx wrangler secret put HITPAY_API_KEY`, `npx wrangler secret put HITPAY_WEBHOOK_SALT`, and `npx wrangler secret put HITPAY_MODE` (`sandbox` or `live`). Do not commit or share the values.
5. In the HitPay dashboard (Developers > Webhooks), add the webhook URL `https://<your-site>/api/payments/hitpay-webhook`, subscribe to the payment request completed event, and copy that webhook's salt into `HITPAY_WEBHOOK_SALT`.
6. Deploy the site and API with `npm run cloudflare:deploy`.
7. Prepare the first admin account using `npm run cloudflare:admin:sql`. The command asks for the admin details and prints SQL containing a password hash. Keep it private and run it in the Cloudflare dashboard's D1 database console. Do not expose the admin password or generated SQL.
8. Check `/api/health`, then test registration, login, HitPay sandbox GCash checkout, signed webhook confirmation, walk-in cash recording, receipts, and overlapping-date handling before sharing the site.

For local Worker testing, copy `.dev.vars.example` to `.dev.vars`, set private `JWT_SECRET`, `HITPAY_API_KEY`, `HITPAY_WEBHOOK_SALT`, and `HITPAY_MODE=sandbox` values, run `npm run cloudflare:db:migrate:local`, and start `npm run cloudflare:dev`. Wrangler uses local D1 and R2 emulation; the existing `npm run dev` command continues to use the Express/PostgreSQL backend.

Cloudflare free-plan quotas apply and can change. Workers Free has a 10 ms CPU limit per request; the secure PBKDF2 password hashing used here may exceed that limit in production. Test registration and login on the actual Cloudflare plan before launch. Do not reduce password-hash strength to fit a free quota; if Cloudflare reports CPU-limit errors, use a plan with a higher CPU limit or a managed authentication service. D1 and R2 are separate resources: configure and periodically test backups/exports for the data you need to retain. The R2 bucket must remain private; payment proofs are served only through the admin-authorized API. Never enable public bucket access. This app records manually verified payments and does not process payments directly.

## Booking rate calculation

The customer selects Overnight (2:00 PM–12:00 NN), Day Tour (7:00 AM–5:00 PM), or Night Tour (7:00 PM–6:00 AM), then chooses an accommodation and date range. Checkout is the exclusive end date, so the date difference is the number of booked days. Each accommodation has two poster rates, Day/Night Tour (one session, the same room rate for both tours) and Overnight (22 hours): Abelyn's Cabin Glass ₱6,000 / ₱7,500; Bahay Hapag ₱2,500 / ₱3,500; Balai Delnor ₱6,500 / ₱8,000; Gazebo ₱1,000 / ₱2,000; Balay Buknoy ₱4,000 / ₱5,000; Abelyn's Mini Event Area ₱2,500 / ₱3,500 (20 pax, or 10 overnight); Balai Andeng ₱1,200 / ₱1,500; Calesa Tables ₱500 / ₱500; Kubo ni Gerrant ₱1,000 / ₱1,500. A one-day Day or Night Tour uses the Day/Night rate with that tour's entrance included up to the rooms' pax; extra guests pay it (Day Tour adult ₱150, senior/PWD/child ₱120; Night Tour adult ₱250, senior/PWD/child ₱150). For example, a Night Tour in Abelyn's Cabin Glass is ₱6,000 for up to 8 guests, plus ₱250 per extra adult. Overnight and every booking of 2 or more days use the Overnight rate for each day (Abelyn's Cabin Glass for 3 days is 3 × ₱7,500 = ₱22,500) and the Night Tour entrance rates, charged per day. On every tour, entrance is included up to the rooms' pax (counting adults first, then seniors/PWD, then children) and extra heads pay it, except Gazebo, Calesa Tables, and Kubo ni Gerrant, which charge entrance for every guest. For example, a three-day Bahay Hapag stay is ₱10,500 (3 × ₱3,500) before entrance fees.

**Several accommodations in one booking.** Customers (and admins logging a walk-in) can tick more than one accommodation, for example Bahay Hapag + Balai Delnor. The booking stores every ID in `accommodation_ids` (a Postgres `text[]`, or a JSON array in D1, added by migration `0005`); `accommodation_id` keeps the first one and `accommodation_name` the combined name ("Bahay Hapag + Balai Delnor"). Each accommodation has a maximum number of guests (its `capacity`), and guests above that pay the entrance fee (a booking may have up to 100 guests). The booking form fills the room's pax with the main guests first and only then lets the customer add extra guests by type; requests send them as `extraGuests: { adults, seniorsPwd, children }`, the server checks they are exactly the guests beyond the pax and charges their entrance, and stores them in `extra_guests` (added by migration `0007` on D1, automatically on Postgres). Requests without `extraGuests` are priced as if the extra heads were adults; the form caps the guest steppers and suggests adding another accommodation. Accommodation rates add up, and entrance fees are charged once per guest after the combined included capacity (Gazebo, Calesa Tables, and Kubo ni Gerrant include no one). Availability, holds, and confirmations treat the booking as one: it conflicts with another booking if they share any accommodation, or if either includes Abelyn's Cabin Glass or Balai Delnor (whole resort). The API accepts `accommodationIds: string[]` (the older single `accommodationId` still works), and availability is checked with `GET /api/availability?accommodationIds=bahay-hapag,balai-delnor&checkInDate=…&checkOutDate=…`. The server derives the display name itself.

## Authentication and authorization

The API exposes `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, and `GET /api/admin/me`. Login accepts a username or email. Signed JWT access tokens expire after eight hours and are held in browser session storage; signing out removes the token from that browser. Protected routes use the account's current database role, so role changes and deleted accounts take effect immediately even if an older token is still present. Login and registration requests are rate limited.

For local PostgreSQL deployments, use HTTPS, protect `DATABASE_URL` and `JWT_SECRET`, set `APP_ORIGIN` to the exact public site origin, and configure database backups and monitoring. Anyone with database access can change account roles; restrict that access. The Cloudflare Worker uses a same-origin API, a D1 binding, and a Wrangler `JWT_SECRET` instead.

## Booking and payment hierarchy

Bookings and payment history are stored in PostgreSQL for Express or D1 for Cloudflare. **Tier 1: Online Reservation (GCash)** requires sign-in and creates a date reservation after HitPay confirms payment. The HitPay payment request charges the 50% base resort deposit plus a separate 2.5% gateway/convenience fee (stored and shown separately on the receipt) using `onlineCharge = round(baseDeposit / 0.975, 2)`; the remaining 50% base balance is due in cash at check-in. HitPay's published GCash rate is 2.3% plus VAT; the rate is set by `ONLINE_FEE_RATE` in the payments code. Verify the resort's actual payment-provider fee agreement before switching from test to live mode.

The customer is redirected to a booking-success page after checkout, but that redirect does not confirm payment. HitPay redirects customers to `/booking/return/<reference>`. Only a webhook with a valid `Hitpay-Signature` (HMAC-SHA256 of the raw body with the webhook salt) can confirm a booking, and the server then re-reads the payment request from HitPay's API and checks its status, reference, amount, and the stored payment request ID before marking it paid. Configure `HITPAY_API_KEY`, `HITPAY_WEBHOOK_SALT`, and `HITPAY_MODE` as environment secrets and register `/api/payments/hitpay-webhook` in HitPay. The webhook records HitPay's payment ID. An official, printable receipt shows the booking reference, payment tier, resort rate, gateway fee, paid amount, and cash balance.

**Tier 2: Walk-In / No Reservation (Cash)** is same-day only and does not hold a date in advance. An admin can use **Log Walk-In Cash Booking** to check current confirmed-date conflicts and record the full resort rate as collected cash. Walk-ins have a unique `TRP-CASH-YYYYMMDD-XXXX` reference, a confirmed/paid-cash customer status, and a ₱0 gateway fee. Online reservations use `TRP-GCASH-YYYYMMDD-XXXX` references. Confirmation checks preserve the whole-resort exclusivity rule for Abelyn's Cabin Glass and Balai Delnor.

**First come, first served.** A date stays open to everyone until a booking is `CONFIRMED`; only confirmed bookings block availability. Inquiries, unfinished GCash checkouts, walk-in vouchers, and cancelled bookings never reserve a date. A signed-in guest who isn't paying online yet can use **Hold Date as Pending Inquiry** in the checkout modal (`POST /api/bookings/pending-hold`). That creates a soft hold (`priority_rank` 2): status `PENDING_HOLD`, tier `PENDING_CASH_INQUIRY`, reference `TRP-HOLD-YYYYMMDD-XXXX`, and `expires_at` set to the end of the check-in date (Philippine time). Several guests may hold the same open dates. Whichever booking is confirmed first gets them: a verified GCash deposit (`priority_rank` 1), a hold confirmed with cash, a walk-in, recorded cash, or a verified payment proof. Each of these confirmations releases every overlapping hold (`CANCELLED_BY_GCASH_PRIORITY`, shown as "Released · confirmed for another guest") in the same transaction. A guest can't hold the same slot twice, confirmed dates can't be held, and each account may have at most 2 active holds. Holds past that time become `EXPIRED` whenever bookings or availability are read, every 15 minutes on Cloudflare (cron trigger in `wrangler.jsonc`), and every 15 minutes in the Express server. In the admin dashboard, **Mark Cash Paid & Confirm** (`POST /api/admin/bookings/:id/confirm-hold-cash`) records the full base rate in cash and confirms the booking under a new `TRP-CASH` reference. The original `TRP-HOLD` reference is kept in `hold_reference_number`. The admin's generic cash and payment-proof flows refuse holds.

Legacy screenshot-based payment reports remain available in the API for existing records. New customer reservations use HitPay checkout; never ask customers to provide a PIN, password, or OTP.

The admin dashboard includes **All Inquiries**, **DownPayments**, **Full Payment**, and **Walk-In Cash** views. Each booking shows its reference number, payment tier, net resort earnings, separated gateway fee, HitPay transaction ID when applicable, payment history, and the same printable receipt available to the customer.

An admin's payment-received verification secures the accommodation and date interval if no confirmed booking conflicts with it. Abelyn's Cabin Glass and Balai Delnor are exclusive private stays (the resort and pool are private for that group, but only the booked rooms are included): once either is confirmed, no other accommodation can be confirmed for overlapping dates; an existing confirmed booking at any accommodation also prevents either exclusive option from being confirmed. Pending inquiries do not hold dates. Confirmation checks are serialized across the resort so overlapping payments cannot both secure the same dates. If a transfer was actually received after those dates were secured, the payment is recorded as received, the booking is marked date unavailable, and the admin/customer are prompted to arrange follow-up rather than the system pretending the transfer was rejected. Tour times are shown on each booking; the checkout date is exclusive and is not billed as an additional day. Other accommodations may still be booked independently when their dates do not overlap an exclusive whole-resort booking.

Payment screenshots are stored privately under `server/storage/payment-proofs/` for the local Express backend. The Cloudflare Worker stores them in the private R2 bucket and serves them only through the admin-authorized API. Other production hosts must provide durable private storage; never use an ephemeral filesystem for payment proofs. Use HTTPS, access controls, retention policies, and backups. This app records manually verified payments; it does not process payments directly or replace a payment processor.

## Users, safe removal, and resort operations (admin)

**Users tab.** `GET /api/admin/users` (admin only) returns every account with `successfulBookings` (status `CONFIRMED` or payment `PAID`), `failedOrExpiredBookings` (`EXPIRED`, `CANCELLED`, `CANCELLED_BY_GCASH_PRIORITY`, an expired hold, or payment `NOT_PAID` — this app's "failed payment" state), `pendingHolds` (unexpired walk-in vouchers), and a `bookingsHistory` drill-down. The rules live in `server/src/userStats.ts`, shared by Express and the Worker. The admin sidebar's **Users** item shows these per account, with a booking-history drawer.

**Safe user removal.** `bookings.user_id` is nullable with `ON DELETE SET NULL` (applied at startup for PostgreSQL; migration `0006` for D1), so removing an account never fails on the foreign key and never erases revenue history. `DELETE /api/admin/users/:id` keeps the account's bookings and payments by default and copies the customer's name and email onto each booking first. `?purgeBookings=true` deletes the account's bookings, payments, and payment screenshots too (for test accounts); the UI asks the admin to type the username first. Admins can't remove their own account or the last admin, and admin accounts can't be purged because walk-in cash bookings are recorded under the admin who logged them. A removed user's existing sign-in stops working immediately.

**Blocked dates.** `POST /api/admin/blocked-dates` (`{ accommodationIds, startDate, endDate, reason }`, `endDate` exclusive, `[]` = whole resort), `GET` and `DELETE /api/admin/blocked-dates/:id`. Closed dates are unavailable on the customer page (`/api/availability` returns `blocked: true`), can't be held (`DATE_BLOCKED`), paid online (checked before HitPay checkout opens), logged as walk-ins, or confirmed; a payment that arrives for closed dates is treated like a date conflict (`DATE_UNAVAILABLE`, refund follow-up). Confirmed bookings already on those dates aren't cancelled: the response lists their references so the admin can reschedule them. Use **Block Dates / Maintenance** next to **Log Walk-In Cash Booking**.

**Reschedule.** `PATCH /api/admin/bookings/:id/reschedule` (`{ checkInDate }`) moves a confirmed booking to a new check-in date (today or later), keeping its length of stay, price, reference number (`TRP-GCASH-…` / `TRP-CASH-…`), and payment history. It is refused if the new dates overlap another confirmed booking or blocked dates, and it releases unpaid walk-in vouchers on the new dates, like any confirmation. Use **Reschedule** on a confirmed booking card.

**Earnings CSV.** **Export CSV** on the Earnings page downloads the selected month's payment ledger (Manila time, gross / gateway fee / net, and whether each payment counts toward earnings).

## Other commands

- `npm.cmd run build` — build the customer frontend.
- `npm.cmd run build:server` — compile the API.
- `npm.cmd run lint` — lint the frontend.

Rates and entrance-fee capacity assumptions are documented on the customer page; confirm them with Tampisawan before enabling real bookings.
