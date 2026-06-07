import { useRef, useState } from 'react';
import LZString from 'lz-string';
import { Profile, PortalSlot, supabase } from '../lib/supabase';

type PortalUploadStatus = 'idle' | 'uploading' | 'success' | 'error';

type Props = {
  profile: Profile;
  isAdmin: boolean;
  periodLabel: string | null;
  view: PortalSlot;
  onViewChange: (v: PortalSlot) => void;
  onUploadClick: () => void;
  onPortalUploaded: (slot: PortalSlot) => void;
  onKundeloggUploaded: () => void;
  onLogout: () => void;
};

const SLOT_LABEL: Record<PortalSlot, string> = {
  analyse: 'Analyseportal',
  crm: 'CRM',
  modell: 'Betjeningsmodell',
};

export default function TopBar({
  profile,
  isAdmin,
  periodLabel,
  view,
  onViewChange,
  onUploadClick,
  onPortalUploaded,
  onKundeloggUploaded,
  onLogout,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const kundeloggInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<PortalSlot>('analyse');
  const [portalStatus, setPortalStatus] = useState<PortalUploadStatus>('idle');
  const [portalMsg, setPortalMsg] = useState('');

  function triggerUpload(slot: PortalSlot) {
    pendingSlotRef.current = slot;
    fileInputRef.current?.click();
  }

  /** Leser opplastet kundelogg.html, henter ut og rekomprimerer hendelsene,
   *  lagrer dem sentralt i crm_kundelogg og legger dem i localStorage. */
  async function handleKundeloggFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setPortalStatus('uploading');
    setPortalMsg('Leser kundelogg…');
    try {
      const text = await file.text();
      const m = text.match(/<script id="payload"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) throw new Error('Fant ikke logg-data i fila.');
      const bin = Uint8Array.from(atob(m[1].trim()), (c) => c.charCodeAt(0));
      const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
      const json = await new Response(stream).text();
      const entries = JSON.parse(json);
      const payload_lz = LZString.compressToBase64(JSON.stringify(entries));

      const { error } = await supabase
        .from('crm_kundelogg')
        .insert({ payload_lz, n_entries: entries.length, uploaded_by: profile.id });
      if (error) throw new Error(error.message);

      localStorage.setItem('vbKundelogg', payload_lz);
      setPortalStatus('success');
      setPortalMsg(`Kundelogg lastet opp (${entries.length.toLocaleString('nb')} hendelser).`);
      onKundeloggUploaded();
      setTimeout(() => setPortalStatus('idle'), 4000);
    } catch (err: any) {
      setPortalStatus('error');
      setPortalMsg('Feil: ' + (err.message ?? String(err)));
    }
  }

  async function handlePortalFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const slot = pendingSlotRef.current;
    const name = SLOT_LABEL[slot];

    setPortalStatus('uploading');
    setPortalMsg(`Laster opp ${name}…`);

    const text = await file.text();
    const warning =
      file.size < 50_000 ? ' ⚠ Fila er svært liten – sjekk at det er riktig fil.' : '';

    const { error } = await supabase
      .from('portal_html')
      .insert({ html: text, uploaded_by: profile.id, slot });

    if (error) {
      setPortalStatus('error');
      setPortalMsg('Feil: ' + error.message);
    } else {
      setPortalStatus('success');
      setPortalMsg(`${name} lastet opp.` + warning);
      onPortalUploaded(slot);
      onViewChange(slot);
      setTimeout(() => setPortalStatus('idle'), warning ? 8000 : 4000);
    }
  }

  return (
    <div className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 gap-4 flex-shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <svg viewBox="0 0 226.77 226.77" fill="currentColor" aria-hidden="true" className="w-7 h-7 text-[#252525] flex-shrink-0">
          <polygon points="132.19 54.15 113.37 37.67 94.58 54.15 113.37 93.5 132.19 54.15" />
          <polygon points="113.39 157.78 74.73 77.07 54.88 77.07 104.06 182.81 104.24 182.81 122.53 182.81 122.71 182.81 171.89 77.07 152.04 77.07 113.39 157.78" />
          <path d="m113.39,0C50.86,0,0,50.86,0,113.39s50.86,113.39,113.39,113.39,113.39-50.86,113.39-113.39S175.91,0,113.39,0Zm0,223.54c-60.74,0-110.15-49.41-110.15-110.15S52.65,3.23,113.39,3.23s110.15,49.41,110.15,110.15-49.41,110.15-110.15,110.15Z" />
        </svg>
        <span className="hidden md:inline font-semibold text-gray-900 text-sm whitespace-nowrap">
          Vikingbad
        </span>

        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 ml-1">
          {(['analyse', 'crm', 'modell'] as PortalSlot[]).map((slot) => (
            <button
              key={slot}
              onClick={() => onViewChange(slot)}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                view === slot
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {SLOT_LABEL[slot]}
            </button>
          ))}
        </div>

        {view === 'analyse' && periodLabel && (
          <span className="hidden lg:inline text-xs text-gray-400 border border-gray-200 rounded-full px-2.5 py-0.5">
            t.o.m. {periodLabel}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {portalStatus !== 'idle' && (
          <span
            className={`hidden sm:block text-xs px-2.5 py-1 rounded-lg ${
              portalStatus === 'error'
                ? 'bg-red-50 text-red-600'
                : portalStatus === 'success'
                ? 'bg-green-50 text-green-700'
                : 'bg-blue-50 text-blue-600'
            }`}
          >
            {portalMsg}
          </span>
        )}

        <span className="hidden lg:block text-sm text-gray-500 mr-1">
          {profile.full_name || profile.email}
        </span>

        {isAdmin && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".html,.htm"
              className="hidden"
              onChange={handlePortalFileChange}
            />
            <button
              onClick={() => triggerUpload('analyse')}
              disabled={portalStatus === 'uploading'}
              title="Last opp ny analyseportal (HTML)"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-xs font-medium px-3 py-1.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              Portal
            </button>

            <button
              onClick={() => triggerUpload('crm')}
              disabled={portalStatus === 'uploading'}
              title="Last opp ny CRM (HTML)"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-xs font-medium px-3 py-1.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              CRM
            </button>

            <input
              ref={kundeloggInputRef}
              type="file"
              accept=".html,.htm"
              className="hidden"
              onChange={handleKundeloggFileChange}
            />
            <button
              onClick={() => kundeloggInputRef.current?.click()}
              disabled={portalStatus === 'uploading'}
              title="Last opp kundelogg (HTML) – mates inn i CRM-en"
              className="hidden md:inline-flex items-center gap-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-xs font-medium px-3 py-1.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              Kundelogg
            </button>

            <button
              onClick={onUploadClick}
              title="Last opp nytt datasett (xlsx)"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span className="hidden sm:inline">Datasett</span>
            </button>
          </>
        )}

        <button
          onClick={onLogout}
          title="Logg ut"
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-xs font-medium px-3 py-1.5 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span className="hidden sm:inline">Logg ut</span>
        </button>
      </div>
    </div>
  );
}
