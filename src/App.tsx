import { useState, useEffect, useRef } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, Profile, PortalSlot } from './lib/supabase';
import LoginForm from './components/LoginForm';
import TopBar from './components/TopBar';
import PortalFrame from './components/PortalFrame';
import UploadModal from './components/UploadModal';
import AdminPanel from './components/AdminPanel';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [caps, setCaps] = useState<string[]>([]);
  const [periodLabel, setPeriodLabel] = useState<string | null>(null);
  const [datasetReady, setDatasetReady] = useState(false);
  const [analyseHtml, setAnalyseHtml] = useState<string | null | undefined>(undefined);
  const [crmHtml, setCrmHtml] = useState<string | null | undefined>(undefined);
  const [modellHtml, setModellHtml] = useState<string | null | undefined>(undefined);
  const [view, setView] = useState<PortalSlot>(
    () => (localStorage.getItem('vbView') as PortalSlot) || 'analyse'
  );
  const [showUpload, setShowUpload] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [datasetLz, setDatasetLz] = useState('');
  const [kundeloggLz, setKundeloggLz] = useState('');
  const analyseIframeRef = useRef<HTMLIFrameElement>(null);
  const crmIframeRef = useRef<HTMLIFrameElement>(null);
  const modellIframeRef = useRef<HTMLIFrameElement>(null);

  const crmHeadInject = (() => {
    const cfg = JSON.stringify({
      url: import.meta.env.VITE_SUPABASE_URL,
      key: import.meta.env.VITE_SUPABASE_ANON_KEY,
    });
    const esc = (s: string) => JSON.stringify(s || '').replace(/</g, '\\u003c');
    const ds = datasetLz || localStorage.getItem('vbDataset2') || '';
    const kl = kundeloggLz || localStorage.getItem('vbKundelogg') || '';
    return `<script>window.__VB_CFG__=${cfg};window.__VB_DATASET__=${esc(ds)};window.__VB_KUNDELOGG__=${esc(kl)};</script>`;
  })();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (datasetReady && crmHtml) {
      const t = setTimeout(() => reloadCrm(), 400);
      return () => clearTimeout(t);
    }
  }, [datasetReady, crmHtml]);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setCaps([]);
      setDatasetReady(false);
      setAnalyseHtml(undefined);
      setCrmHtml(undefined);
      setModellHtml(undefined);
      return;
    }
    loadProfile(session.user.id);
    loadDataset();
    loadKundelogg();
    loadHtml('analyse');
    loadCrm();
    loadModell();
  }, [session?.user.id]);

  function selectView(v: PortalSlot) {
    setView(v);
    localStorage.setItem('vbView', v);
  }

  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, ra, aktiv')
      .eq('id', userId)
      .single();
    if (data) {
      setProfile(data as Profile);
      const { data: roleRow } = await supabase
        .from('app_roles')
        .select('capabilities')
        .eq('role_key', data.role)
        .maybeSingle();
      setCaps((roleRow?.capabilities ?? []) as string[]);
    }
  }

  async function loadDataset() {
    const { data } = await supabase
      .from('datasets')
      .select('payload_lz, period_label')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.payload_lz) {
      localStorage.setItem('vbDataset2', data.payload_lz);
      setDatasetLz(data.payload_lz);
      setPeriodLabel(data.period_label ?? null);
    }
    setDatasetReady(true);
  }

  async function loadHtml(slot: 'analyse') {
    const { data } = await supabase
      .from('portal_html')
      .select('html')
      .eq('slot', slot)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    setAnalyseHtml(data?.html ?? null);
  }

  async function loadCrm() {
    const { data } = await supabase
      .from('portal_html')
      .select('html')
      .eq('slot', 'crm')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.html) {
      setCrmHtml(data.html);
      return;
    }

    try {
      const res = await fetch('/crm.html', { cache: 'no-cache' });
      setCrmHtml(res.ok ? await res.text() : null);
    } catch {
      setCrmHtml(null);
    }
  }

  async function loadModell() {
    const { data } = await supabase
      .from('portal_html')
      .select('html')
      .eq('slot', 'modell')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.html) { setModellHtml(data.html); return; }

    try {
      const res = await fetch('/betjeningsmodell.html', { cache: 'no-cache' });
      setModellHtml(res.ok ? await res.text() : null);
    } catch {
      setModellHtml(null);
    }
  }

  async function loadKundelogg() {
    const { data } = await supabase
      .from('crm_kundelogg')
      .select('payload_lz')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.payload_lz) {
      localStorage.setItem('vbKundelogg', data.payload_lz);
      setKundeloggLz(data.payload_lz);
    }
  }

  function reloadAnalyse() {
    analyseIframeRef.current?.contentWindow?.location.reload();
  }

  function reloadCrm() {
    crmIframeRef.current?.contentWindow?.location.reload();
  }

  async function handleKundeloggUploaded() {
    await loadKundelogg();
    setTimeout(reloadCrm, 100);
  }

  function handleUploadSuccess(lz: string, label: string) {
    localStorage.setItem('vbDataset2', lz);
    setDatasetLz(lz);
    setPeriodLabel(label);
    setShowUpload(false);
    setTimeout(reloadAnalyse, 100);
    setTimeout(reloadCrm, 100);
  }

  async function handlePortalUploaded(slot: PortalSlot) {
    if (slot === 'crm') await loadCrm();
    else if (slot === 'modell') await loadModell();
    else await loadHtml('analyse');
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
      </div>
    );
  }

  if (!session) return <LoginForm />;

  // Fall back to 'analyse' if user is on 'crm' without the cap (only once caps are known)
  const effectiveView: PortalSlot =
    view === 'crm' && caps.length > 0 && !caps.includes('crm.view') ? 'analyse' : view;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">
      {profile && (
        <TopBar
          profile={profile}
          caps={caps}
          periodLabel={periodLabel}
          view={effectiveView}
          onViewChange={selectView}
          onUploadClick={() => setShowUpload(true)}
          onPortalUploaded={handlePortalUploaded}
          onKundeloggUploaded={handleKundeloggUploaded}
          onAdminClick={() => setShowAdmin(true)}
          onLogout={handleLogout}
        />
      )}

      <div className="relative flex-1 min-h-0">
        <PortalFrame
          ref={analyseIframeRef}
          ready={datasetReady}
          html={analyseHtml}
          hidden={effectiveView !== 'analyse'}
          emptyHint="Admin kan laste opp analyseportalen (HTML) via topplinjen."
        />
        <PortalFrame
          ref={crmIframeRef}
          ready={datasetReady}
          html={crmHtml}
          hidden={effectiveView !== 'crm'}
          headInject={crmHeadInject}
          emptyHint="Admin kan laste opp CRM-en (HTML) via topplinjen."
        />
        <PortalFrame
          ref={modellIframeRef}
          ready={true}
          html={modellHtml}
          hidden={effectiveView !== 'modell'}
          emptyHint="Legg betjeningsmodell.html i public/ (eller last opp via topplinjen)."
        />
      </div>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
      )}

      {showAdmin && (
        <AdminPanel onClose={() => setShowAdmin(false)} />
      )}
    </div>
  );
}
