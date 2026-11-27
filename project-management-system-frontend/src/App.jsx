/** @import { AppData } from './data/api' */
// The app's entry: which page this address is, and, for the main app, whether someone is signed in. Kept small: the
// sign-in page (and the platform page before an organisation is chosen) must paint fast, so everything else loads on
// demand: the signed-in app (SignedInApp.jsx), the Platform Administrators' page and the executive page.
import { Suspense, lazy } from "react";
import { Eye } from "lucide-react";
import { BRAND } from "./data/brand";
import { shareToken, useAppData } from "./data/api";
import Login from "./components/Login";
import ForcePasswordChange from "./components/ForcePasswordChange";
import ForceMfaSetup from "./components/ForceMfaSetup";
import UpdateBanner from "./components/UpdateBanner";

const SignedInApp = lazy(() => import("./SignedInApp"));
const ExecutivePage = lazy(() => import("./components/ExecutivePage"));
const PlatformPage = lazy(() => import("./components/PlatformPage"));

// /executive is a public showcase for leadership: totals only, no sign-in, linked from nowhere.
const isExecutive = () => /^\/executive(\/[a-f0-9]{64})?\/?$/.test(window.location.pathname);
// /platform is for Platform Administrators: its own sign-in, outside every organisation.
const isPlatform = () => /^\/platform\/?$/.test(window.location.pathname);

/** While data or a page's code loads: the neutral PMS mark (nobody knows which organisation yet). */
export function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading">
      <span className="splash-pms">{BRAND.shortName}</span>
    </div>
  );
}

export default function App() {
  return <Suspense fallback={<Splash />}>{isExecutive() ? <ExecutivePage /> : isPlatform() ? <PlatformPage /> : <Tracker />}</Suspense>;
}

function Tracker() {
  const { data, mustChange, changeFor, mfaSetup, shareError, loading, reload } = useAppData();
  return (
    <>
      {loading ? (
        <Splash />
      ) : shareToken && !data ? (
        // A view-only link never falls through to the sign-in screen.
        <div className="share-ended">
          <Eye size={28} />
          <h1>This link no longer works</h1>
          <p>{shareError ?? "This view-only link has expired or been turned off."} Ask whoever sent it for a new one.</p>
        </div>
      ) : data ? (
        <SignedInApp data={/** @type {AppData} */ (data)} reload={reload} />
      ) : mustChange ? (
        <ForcePasswordChange message={mustChange} who={changeFor} onDone={reload} />
      ) : mfaSetup ? (
        <ForceMfaSetup message={mfaSetup} onDone={reload} />
      ) : (
        <Login onSignedIn={reload} />
      )}
      <UpdateBanner />
    </>
  );
}
