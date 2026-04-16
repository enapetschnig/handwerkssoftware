import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useParams, useSearchParams } from "react-router-dom";
import { OnboardingProvider } from "./contexts/OnboardingContext";
import { InstallPromptDialog } from "./components/InstallPromptDialog";
import { useOnboarding } from "./contexts/OnboardingContext";
import { supabase } from "@/integrations/supabase/client";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import TimeTracking from "./pages/TimeTracking";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import ProjectOverview from "./pages/ProjectOverview";
import MyHours from "./pages/MyHours";
import MyDocuments from "./pages/MyDocuments";
import Reports from "./pages/Reports";
import ConstructionSites from "./pages/ConstructionSites";
import Admin from "./pages/Admin";
import HoursReport from "./pages/HoursReport";
import Employees from "./pages/Employees";
import Notepad from "./pages/Notepad";
import MaterialList from "./pages/MaterialList";
import Disturbances from "./pages/Disturbances";
import DisturbanceDetail from "./pages/DisturbanceDetail";
import Invoices from "./pages/Invoices";
import InvoiceDetail from "./pages/InvoiceDetail";
import PurchaseInvoices from "./pages/PurchaseInvoices";
import InvoiceTemplates from "./pages/InvoiceTemplates";
import Customers from "./pages/Customers";
import OfferPackages from "./pages/OfferPackages";
import ScheduleBoard from "./pages/ScheduleBoard";
import Calendar from "./pages/Calendar";
import Bautagesberichte from "./pages/Bautagesberichte";
import BautagesberichtDetail from "./pages/BautagesberichtDetail";
import Besprechungsprotokolle from "./pages/Besprechungsprotokolle";
import BesprechungsprotokollDetail from "./pages/BesprechungsprotokollDetail";
import Ersttermine from "./pages/Ersttermine";
import ErstterminDetail from "./pages/ErstterminDetail";
import NotFound from "./pages/NotFound";

// Wrapper that forces re-mount when id or query params change
function InvoiceDetailKeyed() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const key = `${id || "new"}-${searchParams.get("typ") || ""}-${searchParams.get("from_angebot") || ""}`;
  return <InvoiceDetail key={key} />;
}
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppLayout } from "./components/AppLayout";

const queryClient = new QueryClient();

function AppContent() {
  const {
    showInstallDialog,
    handleInstallDialogClose,
  } = useOnboarding();

  // Ensure user profile exists (for users created via Cloud dashboard)
  useEffect(() => {
    const ensureProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.rpc('ensure_user_profile');
      }
    };
    ensureProfile();
  }, []);

  return (
    <>
      <Routes>
        {/* Public routes */}
        <Route path="/auth" element={<Auth />} />

        {/* Protected routes with sidebar layout (desktop) */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
          <Route path="/time-tracking" element={<ProtectedRoute><TimeTracking /></ProtectedRoute>} />
          <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
          <Route path="/projects/:projectId" element={<ProtectedRoute><ProjectOverview /></ProtectedRoute>} />
          <Route path="/projects/:projectId/:type" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
          <Route path="/projects/:projectId/materials" element={<ProtectedRoute><MaterialList /></ProtectedRoute>} />
          <Route path="/my-hours" element={<ProtectedRoute><MyHours /></ProtectedRoute>} />
          <Route path="/my-documents" element={<ProtectedRoute><MyDocuments /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
          <Route path="/construction-sites" element={<ProtectedRoute><ConstructionSites /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute feature="admin"><Admin /></ProtectedRoute>} />
          <Route path="/hours-report" element={<ProtectedRoute feature="stundenauswertung"><HoursReport /></ProtectedRoute>} />
          <Route path="/employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
          <Route path="/notepad" element={<ProtectedRoute><Notepad /></ProtectedRoute>} />
          <Route path="/disturbances" element={<ProtectedRoute><Disturbances /></ProtectedRoute>} />
          <Route path="/disturbances/:id" element={<ProtectedRoute><DisturbanceDetail /></ProtectedRoute>} />
          <Route path="/invoices" element={<ProtectedRoute feature="rechnungen"><Invoices /></ProtectedRoute>} />
          <Route path="/invoices/templates" element={<ProtectedRoute feature="rechnungen"><InvoiceTemplates /></ProtectedRoute>} />
          <Route path="/invoices/packages" element={<ProtectedRoute feature="rechnungen"><OfferPackages /></ProtectedRoute>} />
          <Route path="/invoices/new" element={<ProtectedRoute feature="rechnungen"><InvoiceDetailKeyed /></ProtectedRoute>} />
          <Route path="/invoices/:id" element={<ProtectedRoute feature="rechnungen"><InvoiceDetailKeyed /></ProtectedRoute>} />
          <Route path="/eingangsrechnungen" element={<ProtectedRoute feature="eingangsrechnungen"><PurchaseInvoices /></ProtectedRoute>} />
          <Route path="/materials" element={<ProtectedRoute feature="materialien"><InvoiceTemplates /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute feature="kunden"><Customers /></ProtectedRoute>} />
          <Route path="/schedule" element={<ProtectedRoute feature="plantafel"><ScheduleBoard /></ProtectedRoute>} />
          <Route path="/calendar" element={<ProtectedRoute feature="kalender"><Calendar /></ProtectedRoute>} />
          <Route path="/bautagesberichte" element={<ProtectedRoute feature="bautagesberichte"><Bautagesberichte /></ProtectedRoute>} />
          <Route path="/bautagesberichte/:id" element={<ProtectedRoute feature="bautagesberichte"><BautagesberichtDetail /></ProtectedRoute>} />
          <Route path="/besprechungsprotokolle" element={<ProtectedRoute feature="protokolle"><Besprechungsprotokolle /></ProtectedRoute>} />
          <Route path="/besprechungsprotokolle/:id" element={<ProtectedRoute feature="protokolle"><BesprechungsprotokollDetail /></ProtectedRoute>} />
          <Route path="/ersttermine" element={<ProtectedRoute feature="ersttermine"><Ersttermine /></ProtectedRoute>} />
          <Route path="/ersttermine/:id" element={<ProtectedRoute feature="ersttermine"><ErstterminDetail /></ProtectedRoute>} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>

      {/* Install Prompt Dialog */}
      <InstallPromptDialog
        open={showInstallDialog}
        onClose={handleInstallDialogClose}
      />
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <OnboardingProvider>
          <AppContent />
        </OnboardingProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
