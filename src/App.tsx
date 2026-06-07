import { useState, useEffect, useRef } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, Profile, PortalSlot } from './lib/supabase';
import LoginForm from './components/LoginForm';
import TopBar from './components/TopBar';
import PortalFrame from './components/PortalFrame';
import UploadModal from './components/UploadModal';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [periodLabel, setPeriodLabel] = useState<string | null>(null);
  const [datasetReady, setDatasetReady] = useState(false);
  const [analyseHtml, setAnalyseHtml] = useState<string | null | undefined>(undefined);
  const [crmHtml, setCrmHtml] = useState<string | null | undefined>(undefined);
  const [view, setView] = useState<PortalSlot>(
    () => (localStorage.getItem('vbView') as PortalSlot) || 'analyse'
  );
  const [showUpload, setShowUpload] = useState(false);
  const analyseIframeRef = useRef<HTMLIFrameElement>(null);
  const crmIframeRef = useRef<HTMLIFrameElement>(null);

  // Supabase-konfig som injiseres i CRM-iframen, slik at CRM-en kan lese/skrive
  // oppgaver og besøk direkte mot Supabase med innlogget brukers økt (samme origin).
  const crmHeadInject =
    `<script>window.__VB_CFG__=${JSON.stringify({
      url: import.meta.env.VITE_SUPABASE_URL,
      key: import.meta.env.VITE_SUPABASE_ANON_KEY,
    })};</script>`;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setDatasetReady(false);
      setAnalyseHtml(undefined);
      setCrmHtml(undefined);
      return;
    }
    loadProfile(session.user.id);
    loadDataset();
    loadKundelogg();
    loadHtml('analyse');
    loadCrm();
  }, [session?.user.id]);

  function selectView(v: PortalSlot) {
    setView(v);
    localStorage.setItem('vbView', v);
  }

  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('id', userId)
      .single();
    if (data) setProfile(data as Profile);
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
      setPeriodLabel(data.period_label ?? null);
    }
    setDatasetReady(true);
  }

  /** Henter nyeste HTML for analyseportalen. */
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

  /**
   * Henter nyeste CRM-HTML fra databasen. Finnes ingen opplastet versjon,
   * faller vi tilbake til den medfølgende prototypen i public/crm.html slik
   * at CRM-en alltid er tilgjengelig.
   */
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

  /**
   * Henter nyeste sentrale kundelogg og legger den i localStorage['vbKundelogg']
   * (base64 LZString), som CRM-en leser ved innlasting. Sentral oppdatering.
   */
  async function loadKundelogg() {
    const { data } = await supabase
      .from('crm_kundelogg')
      .select('payload_lz')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.payload_lz) {
      localStorage.setItem('vbKundelogg', data.payload_lz);
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
    setPeriodLabel(label);
    setShowUpload(false);
    setTimeout(reloadAnalyse, 100);
  }

  async function handlePortalUploaded(slot: PortalSlot) {
    if (slot === 'crm') await loadCrm();
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

  const isAdmin = profile?.role === 'admin';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">
      {profile && (
        <TopBar
          profile={profile}
          isAdmin={!!isAdmin}
          periodLabel={periodLabel}
          view={view}
          onViewChange={selectView}
          onUploadClick={() => setShowUpload(true)}
          onPortalUploaded={handlePortalUploaded}
          onKundeloggUploaded={handleKundeloggUploaded}
          onLogout={handleLogout}
        />
      )}

      <div className="relative flex-1 min-h-0">
        <PortalFrame
          ref={analyseIframeRef}
          ready={datasetReady}
          html={analyseHtml}
          hidden={view !== 'analyse'}
          emptyHint="Admin kan laste opp analyseportalen (HTML) via topplinjen."
        />
        <PortalFrame
          ref={crmIframeRef}
          ready={true}
          html={crmHtml}
          hidden={view !== 'crm'}
          headInject={crmHeadInject}
          emptyHint="Admin kan laste opp CRM-en (HTML) via topplinjen."
        />
      </div>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
      )}
    </div>
  );
}
