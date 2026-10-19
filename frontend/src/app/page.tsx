"use client";

import { useState } from "react";
import { ChopperTab } from "@/components/editor/ChopperTab";
import { ClipsTab } from "@/components/editor/ClipsTab";
import { PreviewPanel } from "@/components/editor/PreviewPanel";
import { Sidebar, type TabKey } from "@/components/editor/Sidebar";
import { SongsTab } from "@/components/editor/SongsTab";
import { WorkspaceTab } from "@/components/editor/WorkspaceTab";
import { EditorProvider } from "@/lib/editor-store";

export default function Home() {
  const [tab, setTab] = useState<TabKey>("songs");
  const inWorkspace = tab === "workspace";

  return (
    <EditorProvider>
      <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 lg:h-screen lg:flex-row lg:overflow-hidden">
        <Sidebar active={tab} onChange={setTab} />

        <main className="min-w-0 flex-1 overflow-y-auto bg-gradient-to-b from-zinc-900/40 to-zinc-950">
          {/* key: re-run the fade-in on tab change. */}
          <div key={tab} className={`mx-auto p-6 animate-fade-in lg:p-10 ${inWorkspace ? "max-w-4xl" : "max-w-6xl"}`}>
            {tab === "songs" && <SongsTab />}
            {tab === "clips" && <ClipsTab />}
            {tab === "chopper" && <ChopperTab onNavigate={setTab} />}
            {tab === "workspace" && <WorkspaceTab onNavigate={setTab} />}
          </div>
        </main>

        {/* The Player only exists while editing: library tabs don't pay for
            video decoding, and switching back remounts it from workspace state. */}
        {inWorkspace && <PreviewPanel />}
      </div>
    </EditorProvider>
  );
}
