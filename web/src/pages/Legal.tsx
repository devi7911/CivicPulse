import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Set these before launch. The Grievance Officer is required under India's DPDP Act 2023 and IT Rules 2021.
const CONTACT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || 'privacy@your-domain.example';
const OPERATOR = (import.meta.env.VITE_OPERATOR_NAME as string | undefined) || 'The CivicPulse team';
const UPDATED = '21 September 2026';

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="card mx-auto max-w-3xl space-y-4 p-5 text-sm leading-relaxed sm:p-8 [&_h2]:pt-2 [&_h2]:text-base [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
      <div>
        <p className="label">Last updated {UPDATED}</p>
        <h1 className="page-title">{title}</h1>
      </div>
      {children}
      <p className="border-t border-line pt-3 text-xs text-muted">Questions or complaints: <a className="font-semibold text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See also the <Link className="underline" to="/privacy">Privacy policy</Link> and <Link className="underline" to="/terms">Terms of use</Link>.</p>
    </article>
  );
}

export function Privacy() {
  return (
    <Page title="Privacy policy">
      <p>{OPERATOR} runs CivicPulse, a community platform for reporting civic problems in Hyderabad. This policy explains what we collect, why, and your rights under India's Digital Personal Data Protection Act, 2023.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Account:</b> account type (individual or organisation, and the organisation's name), name, email, mobile number, address and password (stored hashed by our provider). Your name, account type and organisation name are public; your mobile number and address are visible only to you and are used to contact you about your reports.</li>
        <li><b>Reports without an account:</b> name, email and phone, stored encrypted. Administrators can decrypt them only to contact you about your report, and every such access is logged.</li>
        <li><b>Google sign-in (if you use it):</b> your name and email from Google. We never receive your Google password.</li>
        <li><b>Reports and comments:</b> text, photos, optional short videos and the location you choose. These are public unless you mark a report confidential. Anonymous reports hide your name from the public.</li>
        <li><b>Anti-spam signals:</b> a one-way scrambled (hashed) form of your IP address and a random device ID, used only to enforce posting limits.</li>
        <li><b>Verification (optional):</b> the document image you upload (for example UIDAI's masked Aadhaar, which shows only the last 4 digits) and, for masked Aadhaar, those last 4 digits. Only administrators can see them; the image is deleted after review. We never collect or store full Aadhaar numbers.</li>
        <li><b>Community contributions:</b> posts that verified accounts choose to share, with photos, are public.</li>
        <li><b>Notifications:</b> if you turn them on, a browser push address for your device.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To publish and track reports, and tell you when they change.</li>
        <li>To prevent spam, abuse and fake reports.</li>
        <li>To publish anonymous statistics and open data. Open data never includes names, contact details, descriptions or photos, and locations are rounded to about 100 metres.</li>
      </ul>
      <p>We do not sell your data and we do not show you personalised advertising. Sponsored posts from NGOs are the same for everyone.</p>

      <h2>Your location</h2>
      <p>If you allow it, your device location is used on your device to show nearby reports first and to suggest where a problem is. It is not saved to your profile or shown to anyone. To find nearby reports, the app sends your coordinates to our database in a query that is not stored. Only the location you choose for a report is published with it.</p>

      <h2>Missing-child alerts</h2>
      <p>Alerts are published only at the request of, or with the approval of, the police, with a registered case number. They show a first name, age, photo and last-seen place, and end after 72 hours unless the police ask for more time. When a child is found or the alert is cancelled, the photo and description are deleted. Sighting reports you send, including your name and phone number (required so the police can call you back), go only to the alert team and the police, are never published, and are deleted 30 days after the alert closes.</p>

      <h2>Photos</h2>
      <p>Photo location data (EXIF) is used only to suggest where the problem is. Please blur faces and number plates with the built-in tool before you post.</p>

      <h2>Who processes your data</h2>
      <ul>
        <li>Supabase (database, sign-in and file storage).</li>
        <li>Vercel (website hosting).</li>
        <li>Cloudflare Turnstile (bot protection on sign-in and reporting).</li>
        <li>Google (only if you choose "Continue with Google").</li>
        <li>OpenStreetMap (map tiles; your browser requests them directly).</li>
        <li>Open-Meteo (weather and air quality on the home page; your browser sends it the city centre, or your area rounded to about 1 km if you shared your location).</li>
        <li>OpenStreetMap Nominatim (area search, and naming the locality of a report's pin; receives the place name you type or the pin you chose).</li>
        <li>Browser push services such as Google, Apple and Mozilla, if you enable notifications.</li>
      </ul>
      <p>These providers may store data outside India.</p>

      <h2>How long we keep it</h2>
      <p>Account data is kept until you delete your account. When you do, your profile, contact details, points and emergency contacts are removed; your public reports stay as anonymous civic records. Contact details from reports made without an account are removed after 12 months.</p>

      <h2>Your rights</h2>
      <ul>
        <li><b>Access:</b> Profile, then Download my data.</li>
        <li><b>Correction:</b> edit your details in Profile, or a report while it is pending review.</li>
        <li><b>Erasure:</b> Profile, then Delete my account.</li>
        <li><b>Withdraw consent</b> at any time by deleting your account. For anything else, or to nominate someone to act for you, email us.</li>
      </ul>

      <h2>Grievance Officer</h2>
      <p>{OPERATOR}, <a className="font-semibold text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We acknowledge complaints within 24 hours and resolve them within 15 days. If you are not satisfied, you may complain to the Data Protection Board of India.</p>

      <h2>Children</h2>
      <p>CivicPulse is for people aged 18 and over. We do not knowingly collect data from children.</p>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms of use">
      <h2>What CivicPulse is</h2>
      <p>CivicPulse is a community platform. It is <b>not</b> an official channel of GHMC, the police or any government body. Filing a report here does not guarantee that anyone will act on it. Use the GHMC grievance channels as well. <b>In an emergency, call 112.</b></p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Post only true, relevant information about public places and civic matters.</li>
        <li>Do not post other people's personal details, faces or number plates, or anything abusive, hateful, obscene, defamatory or illegal.</li>
        <li>Do not post spam or advertising, or use automated tools.</li>
        <li>You must be 18 or older.</li>
      </ul>

      <h2>Your content</h2>
      <p>You keep ownership of what you post. You give CivicPulse a free, worldwide licence to display it and share it with authorities, and to publish it in anonymised open data under CC BY 4.0.</p>

      <h2>Moderation</h2>
      <p>We may hide or remove content and suspend accounts that break these terms. Content reported by several users is hidden automatically until a moderator reviews it. To report unlawful content or appeal a decision, email us. We act on valid complaints within the times set by the IT Rules, 2021.</p>

      <h2>Points and rewards</h2>
      <p>Points, tiers and missions are for community recognition. They have no cash value. We may change or end them at any time.</p>

      <h2>Advertising</h2>
      <ul>
        <li>Every ad is reviewed before it runs and is always labelled "Sponsored ad". Users can close any ad.</li>
        <li>Not allowed: political or religious messages, alcohol, tobacco, gambling, loans or crypto, adult content, weapons, medical cure claims, misleading offers, or links that are not the advertiser's own https site.</li>
        <li>Ads are never targeted at individuals. They may be matched to the topic a person is viewing.</li>
        <li>Pricing is ₹100 per 1,000 views, charged from a prepaid budget. Views are counted once per network per day. Unused budget is refundable on request.</li>
        <li>We may reject, pause or remove any ad, and refund the unused budget.</li>
      </ul>

      <h2>Links, payments and donations</h2>
      <p>Bill payments and donations happen on the external websites we link to. CivicPulse never handles your money and is not responsible for those sites.</p>

      <h2>Liability</h2>
      <p>The service is provided as is. To the extent the law allows, we are not liable for losses arising from its use or from content posted by users.</p>

      <h2>Law</h2>
      <p>These terms are governed by the laws of India. The courts in Hyderabad, Telangana have jurisdiction.</p>
    </Page>
  );
}
