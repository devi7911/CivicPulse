import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Upload } from 'lucide-react';
import { Modal } from './Modal';
import { timeAgo } from '../lib/constants';
import { supabase, uploadPhoto } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { AccountType } from '../lib/accounts';
import { friendlyError } from '../lib/friendlyError';

export const DOC_TYPES = {
  masked_aadhaar: 'Masked Aadhaar (only last 4 digits visible)',
  driving_licence: 'Driving licence',
  voter_id: 'Voter ID (EPIC)',
  passport: 'Passport',
  pan_card: 'PAN card',
  other_govt_id: 'Other government photo ID',
  org_registration: 'Organisation registration certificate (NGOs, groups, businesses)',
} as const;
type DocType = keyof typeof DOC_TYPES;

interface Request { id: string; doc_type: DocType; status: 'pending' | 'approved' | 'rejected'; note: string | null; created_at: string }

export function useMyVerification(userId: string | null) {
  return useQuery({
    queryKey: ['my-verification', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('verification_requests')
        .select('id, doc_type, status, note, created_at')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as Request | null;
    },
  });
}

// Which documents each account type may verify with (the database enforces the same rule).
function allowedDocs(t: AccountType | undefined): DocType[] {
  if (t === 'government') return ['org_registration', 'other_govt_id'];
  if (t && t !== 'individual') return ['org_registration'];
  return ['masked_aadhaar', 'driving_licence', 'voter_id', 'passport', 'pan_card', 'other_govt_id'];
}

export function VerifyFlow({ userId, open, onClose }: { userId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const docs = allowedDocs(profile?.account_type);
  const latest = useMyVerification(userId);
  const [picked, setDocType] = useState<DocType>('masked_aadhaar');
  const docType: DocType = docs.includes(picked) ? picked : docs[0];
  const [last4, setLast4] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      if (docType === 'masked_aadhaar' && !/^[0-9]{4}$/.test(last4)) throw new Error('Enter only the last 4 digits of your Aadhaar.');
      const path = await uploadPhoto(userId, file!, 'id-docs');
      const { error } = await supabase.from('verification_requests').insert({
        user_id: userId, doc_type: docType, doc_path: path, aadhaar_last4: docType === 'masked_aadhaar' ? last4 : null,
      });
      if (error) {
        await supabase.storage.from('id-docs').remove([path]);
        throw new Error(error.message.includes('one_pending') ? 'You already have a request waiting for review.' : error.message);
      }
    },
    onSuccess: () => { setFile(null); setAgree(false); setLast4(''); setError(null); qc.invalidateQueries({ queryKey: ['my-verification'] }); },
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: FormEvent) { e.preventDefault(); if (file && agree) submit.mutate(); }

  const pending = latest.data?.status === 'pending';

  return (
    <Modal open={open} title="Get verified" onClose={onClose}>
      {pending ? (
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 font-display text-lg font-semibold"><FileCheck2 size={20} className="text-primary" /> Request received</p>
          <p>Your {DOC_TYPES[latest.data!.doc_type].toLowerCase()} was submitted {timeAgo(latest.data!.created_at)}. A CivicPulse admin will review it shortly.</p>
          <p className="text-xs text-muted">Your document is deleted as soon as the review is finished.</p>
          <button type="button" className="btn btn-ghost w-full" onClick={onClose}>Close</button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4 text-sm">
          {latest.data?.status === 'rejected' && (
            <p className="rounded-xl border border-brick/30 bg-blush p-3 text-xs">
              <span className="font-bold">Your last request was not approved.</span> {latest.data.note ?? 'Please upload a clearer photo of a valid ID.'}
            </p>
          )}
          <p>Verified accounts get a badge, can add a profile picture and can share contributions. An admin checks your document against your profile.</p>
          <div>
            <label htmlFor="doc-type" className="label">Document type</label>
            <select id="doc-type" className="input" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
              {docs.map((d) => <option key={d} value={d}>{DOC_TYPES[d]}</option>)}
            </select>
          </div>
          {docType === 'org_registration' && (
            <p className="rounded-xl border border-line bg-primary-soft p-3 text-xs">Upload your registration certificate: society or trust registration, company incorporation, school recognition, or for government offices an official letter. The organisation name must match your profile.</p>
          )}
          {docType === 'masked_aadhaar' && (
            <div className="space-y-2 rounded-xl border border-line bg-primary-soft p-3 text-xs">
              <p><b>Use the masked Aadhaar only.</b> Download it free from the official UIDAI site: choose "Download Aadhaar" and tick "Do you want a masked Aadhaar?". It shows only the last 4 digits.</p>
              <a href="https://myaadhaar.uidai.gov.in/" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">Open myaadhaar.uidai.gov.in</a>
              <p>We never ask for your full 12-digit number. By law, only licensed agencies may collect it.</p>
              <label htmlFor="last4" className="label mt-2">Last 4 digits of your Aadhaar</label>
              <input id="last4" className="input w-32 tracking-[0.4em]" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="off"
                value={last4} onChange={(e) => setLast4(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} placeholder="••••" />
            </div>
          )}
          <label className="btn btn-ghost w-full cursor-pointer">
            <Upload size={16} /> {file ? file.name.slice(0, 28) : docType === 'masked_aadhaar' ? 'Choose a photo or screenshot of your masked Aadhaar' : 'Choose a photo of your document'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <label className="flex items-start gap-2 text-xs text-muted">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
            <span>I agree to CivicPulse admins viewing this document for verification only. It is stored privately and deleted once reviewed. Only the fact that I am verified is kept.</span>
          </label>
          {error && <p role="alert" className="text-sm font-semibold text-brick">{friendlyError(error)}</p>}
          <button type="submit" className="btn btn-primary w-full" disabled={!file || !agree || submit.isPending || (docType === 'masked_aadhaar' && last4.length !== 4)}>
            {submit.isPending ? 'Uploading…' : 'Submit for review'}
          </button>
        </form>
      )}
    </Modal>
  );
}
