import { useState, useRef, ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import LZString from 'lz-string';
import { supabase } from '../lib/supabase';

type UploadStatus =
  | { stage: 'idle' }
  | { stage: 'reading' }
  | { stage: 'computing' }
  | { stage: 'saving' }
  | { stage: 'done'; periodLabel: string; nCustomers: number; nLines: number }
  | { stage: 'error'; message: string };

type Props = {
  onClose: () => void;
  onSuccess: (lz: string, periodLabel: string) => void;
};

let vbLoaded = false;

async function ensureVB() {
  if (vbLoaded) return;
  (window as any).XLSX = XLSX;
  await import(/* @vite-ignore */ '../lib/recompute.js');
  vbLoaded = true;
}

export default function UploadModal({ onClose, onSuccess }: Props) {
  const [status, setStatus] = useState<UploadStatus>({ stage: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setStatus({ stage: 'reading' });
      const buf = await file.arrayBuffer();

      setStatus({ stage: 'computing' });
      await ensureVB();
      const VB = (window as any).VBRecompute;

      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
      const R = VB.recompute(wb);
      const meta = (window as any).__RECOMP_META__;

      const payload = {
        rows: R.rows,
        ldata: VB.buildLData(R, {}),
        cats: VB.buildCats(R),
        meta,
        name: file.name,
        ts: Date.now(),
      };

      const lz = LZString.compressToUTF16(JSON.stringify(payload));
      const periodLabel = `${R.cD}.${R.cM}.${R.curY}`;

      setStatus({ stage: 'saving' });

      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await supabase.from('datasets').insert({
        filename: file.name,
        period_label: periodLabel,
        n_customers: R.rows.length,
        n_lines: R.lines.length,
        total_revenue: payload.ldata.kpi.omsetning,
        payload_lz: lz,
        uploaded_by: userRes.user?.id,
      });

      if (error) throw new Error(error.message);

      setStatus({
        stage: 'done',
        periodLabel,
        nCustomers: R.rows.length,
        nLines: R.lines.length,
      });

      onSuccess(lz, periodLabel);
    } catch (err: any) {
      setStatus({ stage: 'error', message: err.message ?? String(err) });
    }
  }

  const busy = status.stage === 'reading' || status.stage === 'computing' || status.stage === 'saving';

  const stageLabel: Record<string, string> = {
    reading: 'Leser fil…',
    computing: 'Regner ut analyser…',
    saving: 'Lagrer i databasen…',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Last opp nytt datasett</h2>
          {!busy && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="px-6 py-6">
          {status.stage === 'idle' && (
            <>
              <p className="text-sm text-gray-500 mb-5">
                Velg <span className="font-medium text-gray-700">Datagrunnlag.xlsx</span> for å oppdatere portalen for alle brukere.
                Utregningen kjøres i nettleseren din — det kan ta noen sekunder for store filer.
              </p>
              <button
                onClick={() => inputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-xl py-10 flex flex-col items-center gap-3 text-gray-500 hover:text-blue-600 transition-colors group"
              >
                <svg className="w-10 h-10 text-gray-300 group-hover:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm font-medium">Klikk for å velge fil</span>
                <span className="text-xs text-gray-400">.xlsx</span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={handleFile}
              />
            </>
          )}

          {busy && (
            <div className="flex flex-col items-center gap-5 py-6">
              <div className="w-12 h-12 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
              <p className="text-sm font-medium text-gray-700">
                {stageLabel[status.stage] ?? 'Behandler…'}
              </p>
              <p className="text-xs text-gray-400 text-center">
                Ikke lukk fanen. Parsing av store filer kan ta 5–15 sekunder.
              </p>
            </div>
          )}

          {status.stage === 'done' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="text-center">
                <p className="font-semibold text-gray-900 text-sm">Opplasting fullført</p>
                <p className="text-xs text-gray-500 mt-1">Periode: t.o.m. {status.periodLabel}</p>
                <p className="text-xs text-gray-400">{status.nCustomers} kunder · {status.nLines.toLocaleString('nb')} fakturalinjer</p>
              </div>
              <p className="text-xs text-gray-500 text-center">
                Portalen er oppdatert. Andre brukere ser de nye tallene ved neste innlasting.
              </p>
              <button
                onClick={onClose}
                className="mt-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2 transition-colors"
              >
                Lukk
              </button>
            </div>
          )}

          {status.stage === 'error' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="font-semibold text-gray-900 text-sm">Noe gikk galt</p>
                <p className="text-xs text-red-600 mt-1 max-w-xs break-words">{status.message}</p>
              </div>
              <button
                onClick={() => setStatus({ stage: 'idle' })}
                className="rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium px-5 py-2 transition-colors"
              >
                Prøv igjen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
