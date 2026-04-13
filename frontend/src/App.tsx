import { Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/AppShell/AppShell";
import FloatScraper from "@/pages/FloatScraper/FloatScraper";
import { PlaceholderPage } from "@/pages/PlaceholderPage/PlaceholderPage";

function App() {
  return (
    <TooltipProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<FloatScraper />} />
          <Route path="/float-scraper" element={<FloatScraper />} />
          <Route
            path="/sticker-scraper"
            element={<PlaceholderPage title="Sticker scraper" />}
          />
          <Route
            path="/charm-scraper"
            element={<PlaceholderPage title="Charm scraper" />}
          />
        </Route>
      </Routes>
    </TooltipProvider>
  );
}

export default App;
