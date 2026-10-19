"use client";

import { useState } from "react";
import { ChopperTab } from "@/components/editor/ChopperTab";
import { ClipsTab } from "@/components/editor/ClipsTab";
import { PreviewPanel } from "@/components/editor/PreviewPanel";
import { Sidebar, type TabKey } from "@/components/editor/Sidebar";
import { SongsTab } from "@/components/editor/SongsTab";
import { StockTab } from "@/components/editor/StockTab";
import { WorkspaceTab } from "@/components/editor/WorkspaceTab";
import { EditorProvider, useEditor } from "@/lib/editor-store";

export default function Home() {
  return (
    <EditorProvider>
      <EditorShell />
    </EditorProvider>
  );
}

function EditorShell() {
  const [tab, setTab] = useState<TabKey>("songs");
  const { activeProject } = useEditor();
  const inWorkspace = tab === "workspace";
  // Only an open project has something to preview; the projects grid gets the full width.
  const showPreview = inWorkspace && !!activeProject;

  return (
    <>
      <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 lg:h-screen lg:flex-row lg:overflow-hidden">
        <Sidebar active={tab} onChange={setTab} />

        <main className="min-w-0 flex-1 overflow-y-auto bg-gradient-to-b from-zinc-900/40 to-zinc-950">
          {/* key: re-run the fade-in on tab change. */}
          <div key={tab} className={`mx-auto p-6 animate-fade-in lg:p-10 ${showPreview ? "max-w-4xl" : "max-w-6xl"}`}>
            {tab === "songs" && <SongsTab />}
            {tab === "clips" && <ClipsTab />}
            {tab === "chopper" && <ChopperTab onNavigate={setTab} />}
            {tab === "stock" && <StockTab onNavigate={setTab} />}
            {tab === "workspace" && <WorkspaceTab onNavigate={setTab} />}
          </div>
        </main>

        {/* The Player only exists while editing a project: other tabs don't pay
            for video decoding, and coming back remounts it from project state. */}
        {showPreview && <PreviewPanel />}
      </div>
    </>
  );
}
