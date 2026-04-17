"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";


interface Site {
  id: string;
  business_name: string;
  owner_email: string;
  phone: string;
  email: string;
  address: string;
  hours: string;
  hero_headline: string;
  hero_subheadline: string;
  cta_text: string;
  status: string;
  preview_url: string | null;
  live_url: string | null;
}

interface Version {
  sha: string;
  message: string;
  author: string;
  date: string;
}

interface EditLogEntry {
  id: string;
  action: string;
  summary: string;
  user_email: string | null;
  created_at: string;
}

interface Deployment {
  id: string;
  type: string;
  url: string;
  deployed_at: string;
  deployed_by: string | null;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export default function SiteEditorPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const router = useRouter();
  const [site, setSite] = useState<Site | null>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    filename: string;
    url: string;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [extracting, setExtracting] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [editLog, setEditLog] = useState<EditLogEntry[]>([]);
  const [bottomTab, setBottomTab] = useState<"deployments" | "activity" | "versions" | "locations">("deployments");
  const [locations, setLocations] = useState<Array<{ slug: string; label: string; url: string }>>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsMeta, setLocationsMeta] = useState<{ indexUrl: string | null; total: number } | null>(null);
  const [locationPreview, setLocationPreview] = useState<string | null>(null);

  // Multi-page state
  type PageEntry = { filename: string; label: string; isHome: boolean; slug: string };
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [currentPage, setCurrentPage] = useState("index.html");
  const [showNewPageModal, setShowNewPageModal] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [newPageSlug, setNewPageSlug] = useState("");
  const [newPageCloneFrom, setNewPageCloneFrom] = useState("index.html");
  const [newPageAddToNav, setNewPageAddToNav] = useState(true);
  const [newPageCreating, setNewPageCreating] = useState(false);
  const [newPageError, setNewPageError] = useState("");

  // Left panel tabs
  const [leftTab, setLeftTab] = useState<"details" | "seo" | "images">("details");

  // SEO panel state
  const [seoData, setSeoData] = useState<{ title: string; description: string; canonical: string; ogTitle: string; ogDescription: string; ogImage: string; h1: string } | null>(null);
  const [seoSha, setSeoSha] = useState<string>("");
  const [seoLoading, setSeoLoading] = useState(false);
  const [seoSaving, setSeoSaving] = useState(false);
  const [seoSaved, setSeoSaved] = useState(false);

  // Images/alt text panel state
  type ImgEntry = { index: number; src: string; alt: string; previewUrl: string; context: string };
  const [imgList, setImgList] = useState<ImgEntry[]>([]);
  const [imgSha, setImgSha] = useState<string>("");
  const [imgLoading, setImgLoading] = useState(false);
  const [imgSaving, setImgSaving] = useState(false);
  const [imgSaved, setImgSaved] = useState(false);
  const [imgGenerating, setImgGenerating] = useState(false);
  const [imgGenProgress, setImgGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [imgGeneratingIndex, setImgGeneratingIndex] = useState<number | null>(null);

  // Generate locations modal
  const [showLocModal, setShowLocModal] = useState(false);
  const [locCity, setLocCity] = useState("");
  const [locState, setLocState] = useState("");
  const [locCount, setLocCount] = useState("50");
  const [locRunning, setLocRunning] = useState(false);
  const [locLog, setLocLog] = useState<Array<{ type: "progress" | "page" | "done" | "error"; text: string; status?: string }>>([]);
  const [locDone, setLocDone] = useState(false);

  // Custom domain
  const [domainInput, setDomainInput] = useState("");
  const [domainStatus, setDomainStatus] = useState<"idle" | "adding" | "pending" | "active" | "error">("idle");
  const [domainError, setDomainError] = useState<string | null>(null);
  const [cnameTarget, setCnameTarget] = useState<string | null>(null);
  const [activeDomain, setActiveDomain] = useState<string | null>(null);
  const [removingDomain, setRemovingDomain] = useState(false);
  const domainPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Inject <base href> so relative asset paths resolve to the deployed CF Pages origin
  function buildBlobPreview(html: string, siteId: string): string {
    const base = `<base href="https://${siteId}.pages.dev/">`;
    return html.includes("<head>")
      ? html.replace("<head>", `<head>${base}`)
      : base + html;
  }

  function revokeBlobUrl() {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }
  }

  useEffect(() => () => revokeBlobUrl(), []); // cleanup on unmount

  // Right panel tab: "chat" | "preview"
  const [rightTab, setRightTab] = useState<"chat" | "preview" | "analytics">("chat");
  const [analyticsData, setAnalyticsData] = useState<{
    pageviews: number; visits: number;
    daily: Array<{ date: string; pageviews: number; visits: number }>;
    countries: Array<{ name: string; count: number }>;
    referrers: Array<{ host: string; count: number }>;
    devices: Array<{ type: string; count: number }>;
  } | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [previewKey, setPreviewKey] = useState(0); // increment to force iframe reload
  const [deviceView, setDeviceView] = useState<"desktop" | "tablet" | "mobile">("desktop");

  // Deploy status polling
  type DeployState = "idle" | "queued" | "in_progress" | "success" | "failure";
  const [deployState, setDeployState] = useState<DeployState>("idle");
  const deployPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (deployPollRef.current) {
      clearInterval(deployPollRef.current);
      deployPollRef.current = null;
    }
  }, []);

  const pollDeployStatus = useCallback((sha: string) => {
    stopPolling();
    setDeployState("queued");

    deployPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/deploy-status?sha=${sha}`);
        const data = await res.json();

        if (data.status === "completed") {
          stopPolling();
          setDeployState(data.conclusion === "success" ? "success" : "failure");
          // Switch from blob preview back to the live CF Pages URL
          revokeBlobUrl();
          setPreviewKey((k) => k + 1);
          // Reset success badge after 8s
          setTimeout(() => setDeployState("idle"), 8000);
        } else {
          setDeployState(data.status === "in_progress" ? "in_progress" : "queued");
        }
      } catch {
        // Silently retry on network error
      }
    }, 5000);
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  async function fetchSite() {
    const res = await fetch(`/api/sites/${siteId}`);
    const data = await res.json();
    setSite(data.site);
    setDeployments(data.deployments ?? []);
    setEditLog(data.editLog ?? []);
    // Pre-fill location generator from site address
    if (data.site?.address) {
      const addrParts = (data.site.address as string).split(",").map((s: string) => s.trim());
      if (addrParts.length >= 2) {
        const stateZip = addrParts[addrParts.length - 1];
        const stateMatch = stateZip.match(/\b([A-Z]{2})\b/);
        if (stateMatch) setLocState(stateMatch[1]);
        if (addrParts.length >= 3) setLocCity(addrParts[addrParts.length - 2]);
      }
    }
    if (data.chatMessages) {
      setChatMessages(data.chatMessages);
    }
  }

  async function handleExtract() {
    if (!site) return;
    setExtracting(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/extract`);
      const data = await res.json();
      if (data.extracted) {
        setSite((prev) => {
          if (!prev) return prev;
          const e = data.extracted;
          return {
            ...prev,
            business_name: e.business_name ?? prev.business_name,
            phone: e.phone ?? prev.phone,
            email: e.email ?? prev.email,
            address: e.address ?? prev.address,
            hours: e.hours ?? prev.hours,
            hero_headline: e.hero_headline ?? prev.hero_headline,
            hero_subheadline: e.hero_subheadline ?? prev.hero_subheadline,
            cta_text: e.cta_text ?? prev.cta_text,
          };
        });
      }
    } finally {
      setExtracting(false);
    }
  }

  async function fetchAnalytics() {
    if (analyticsLoading || analyticsData) return;
    setAnalyticsLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/analytics`);
      if (res.ok) setAnalyticsData(await res.json());
    } catch { /* ignore */ } finally {
      setAnalyticsLoading(false);
    }
  }

  async function fetchPages() {
    try {
      const res = await fetch(`/api/sites/${siteId}/pages`);
      const data = await res.json();
      if (data.pages) setPages(data.pages);
    } catch { /* non-fatal */ }
  }

  async function createPage() {
    if (!newPageName.trim() || !newPageSlug.trim()) return;
    setNewPageCreating(true);
    setNewPageError("");
    try {
      const res = await fetch(`/api/sites/${siteId}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPageName.trim(),
          slug: newPageSlug.trim(),
          cloneFrom: newPageCloneFrom,
          addToNav: newPageAddToNav,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setNewPageError(data.error || "Failed to create page"); return; }
      await fetchPages();
      setCurrentPage(data.filename);
      setShowNewPageModal(false);
      setNewPageName("");
      setNewPageSlug("");
      setNewPageAddToNav(true);
      // Clear editor state for new page
      setChatMessages([]);
      setBlobUrl(null);
    } catch (err) {
      setNewPageError((err as Error).message);
    } finally {
      setNewPageCreating(false);
    }
  }

  async function deletePage(filename: string) {
    if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    await fetch(`/api/sites/${siteId}/pages/${filename}`, { method: "DELETE" });
    await fetchPages();
    if (currentPage === filename) setCurrentPage("index.html");
  }

  async function fetchSeo() {
    setSeoLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/seo?page=${currentPage}`);
      const data = await res.json();
      if (data.seo) { setSeoData(data.seo); setSeoSha(data.sha); }
    } finally { setSeoLoading(false); }
  }

  async function saveSeo() {
    if (!seoData) return;
    setSeoSaving(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/seo`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seo: seoData, sha: seoSha, page: currentPage }),
      });
      const data = await res.json();
      if (data.sha) setSeoSha(data.sha);
      setSeoSaved(true);
      setTimeout(() => setSeoSaved(false), 2500);
    } finally { setSeoSaving(false); }
  }

  async function fetchImages() {
    setImgLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/images?page=${currentPage}`);
      const data = await res.json();
      if (data.images) { setImgList(data.images); setImgSha(data.sha); }
    } finally { setImgLoading(false); }
  }

  async function generateAltText(indices?: number[]) {
    setImgGenerating(true);
    setImgGenProgress(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/images/generate-alt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(indices?.length ? { indices, page: currentPage } : { page: currentPage }),
      });
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const block of blocks) {
          const eventLine = block.split("\n").find(l => l.startsWith("event:"));
          const dataLine = block.split("\n").find(l => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.replace("event:", "").trim();
          const payload = JSON.parse(dataLine.replace("data:", "").trim());

          if (event === "start") {
            setImgGenProgress({ done: 0, total: payload.total });
          } else if (event === "alt") {
            setImgGeneratingIndex(payload.index);
            if (!payload.skipped && payload.alt) {
              setImgList(prev => prev.map(img =>
                img.index === payload.index ? { ...img, alt: payload.alt } : img
              ));
            }
            setImgGenProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
          } else if (event === "done") {
            setImgGenProgress(prev => prev ? { ...prev, done: prev.total } : null);
            setImgGeneratingIndex(null);
          }
        }
      }
    } finally {
      setImgGenerating(false);
      setImgGeneratingIndex(null);
    }
  }

  async function saveImages() {
    setImgSaving(true);
    try {
      const updates = imgList.map(({ index, alt }) => ({ index, alt }));
      const res = await fetch(`/api/sites/${siteId}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates, sha: imgSha, page: currentPage }),
      });
      const data = await res.json();
      if (data.sha) setImgSha(data.sha);
      setImgSaved(true);
      setTimeout(() => setImgSaved(false), 2500);
    } finally { setImgSaving(false); }
  }

  async function runGenerateLocations() {
    if (!locCity.trim() || !locState.trim()) return;
    setLocRunning(true);
    setLocDone(false);
    setLocLog([]);

    try {
      const res = await fetch(`/api/sites/${siteId}/generate-locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: locCity.trim(), state: locState.trim().toUpperCase(), count: parseInt(locCount, 10) || 50 }),
      });

      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const block of blocks) {
          const lines = block.split("\n");
          const eventLine = lines.find(l => l.startsWith("event:"));
          const dataLine = lines.find(l => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.replace("event:", "").trim();
          const payload = JSON.parse(dataLine.replace("data:", "").trim());

          if (event === "progress") {
            setLocLog(prev => [...prev, { type: "progress", text: payload.message }]);
          } else if (event === "page") {
            const icon = payload.status === "ok" ? "✅" : "❌";
            setLocLog(prev => [...prev, { type: "page", text: `${icon} [${payload.index}/${payload.total}] ${payload.city}`, status: payload.status }]);
          } else if (event === "done") {
            setLocLog(prev => [...prev, { type: "done", text: `✨ Done — ${payload.pushed} pages generated${payload.failed > 0 ? `, ${payload.failed} failed` : ""}` }]);
            setLocDone(true);
            // Refresh locations list
            fetchLocations();
          } else if (event === "error") {
            setLocLog(prev => [...prev, { type: "error", text: `💥 ${payload.message}` }]);
            setLocDone(true);
          }
        }
      }
    } catch (err) {
      setLocLog(prev => [...prev, { type: "error", text: `Error: ${(err as Error).message}` }]);
      setLocDone(true);
    } finally {
      setLocRunning(false);
    }
  }

  async function fetchLocations() {
    if (locationsLoading) return;
    setLocationsLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/locations`);
      if (res.ok) {
        const data = await res.json();
        setLocations(data.locations ?? []);
        setLocationsMeta({ indexUrl: data.indexUrl, total: data.total });
      }
    } catch { /* ignore */ } finally {
      setLocationsLoading(false);
    }
  }

  async function fetchVersions() {
    setVersionsLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/versions?page=${currentPage}`);
      const data = await res.json();
      setVersions(data.versions ?? []);
    } finally {
      setVersionsLoading(false);
    }
  }

  async function handleRollback(sha: string) {
    setRollingBack(sha);
    try {
      const res = await fetch(`/api/sites/${siteId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha, page: currentPage }),
      });
      const data = await res.json();
      if (data.commitSha) {
        pollDeployStatus(data.commitSha);
        await fetchVersions();
        await fetchSite();
      }
    } finally {
      setRollingBack(null);
    }
  }

  // Load existing custom domains on mount
  async function fetchDomains() {
    const res = await fetch(`/api/sites/${siteId}/domain`);
    const data = await res.json();
    if (data.domains?.length > 0) {
      const d = data.domains[0];
      setActiveDomain(d.name);
      setDomainStatus(d.status === "active" ? "active" : "pending");
      if (d.status !== "active") {
        setCnameTarget(d.verification_data?.cname_target ?? `${siteId}.pages.dev`);
        startDomainPolling(d.name);
      }
    }
  }

  function startDomainPolling(domain: string) {
    if (domainPollRef.current) clearInterval(domainPollRef.current);
    domainPollRef.current = setInterval(async () => {
      const res = await fetch(`/api/sites/${siteId}/domain`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (data.status === "active") {
        clearInterval(domainPollRef.current!);
        domainPollRef.current = null;
        setDomainStatus("active");
        setCnameTarget(null);
        await fetchSite();
      }
    }, 15000);
  }

  async function handleAddDomain() {
    if (!domainInput.trim()) return;
    setDomainStatus("adding");
    setDomainError(null);
    const res = await fetch(`/api/sites/${siteId}/domain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: domainInput.trim() }),
    });
    const data = await res.json();
    if (data.error) {
      setDomainError(data.error);
      setDomainStatus("error");
      return;
    }
    const d = data.domain;
    setActiveDomain(d.name);
    if (d.status === "active") {
      setDomainStatus("active");
      await fetchSite();
    } else {
      setDomainStatus("pending");
      // CF Pages returns the project URL as the CNAME target
      setCnameTarget(d.verification_data?.cname_target ?? `${siteId}.pages.dev`);
      startDomainPolling(d.name);
    }
    setDomainInput("");
  }

  async function handleRemoveDomain() {
    if (!activeDomain) return;
    setRemovingDomain(true);
    if (domainPollRef.current) clearInterval(domainPollRef.current);
    await fetch(`/api/sites/${siteId}/domain`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: activeDomain }),
    });
    setActiveDomain(null);
    setDomainStatus("idle");
    setCnameTarget(null);
    setRemovingDomain(false);
    await fetchSite();
  }

  useEffect(() => {
    return () => { if (domainPollRef.current) clearInterval(domainPollRef.current); };
  }, []);

  useEffect(() => {
    fetchSite();
    fetchVersions();
    fetchPages();
    fetchDomains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  async function handleSave() {
    if (!site) return;
    setSaving(true);
    const res = await fetch(`/api/sites/${siteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(site),
    });
    const data = await res.json();
    if (data.html) {
      revokeBlobUrl();
      const preview = buildBlobPreview(data.html, siteId);
      const blob = new Blob([preview], { type: "text/html" });
      setBlobUrl(URL.createObjectURL(blob));
      setRightTab("preview");
      setPreviewKey((k) => k + 1);
    }
    await fetchSite();
    setSaving(false);
  }

  async function handleDeploy(type: "preview" | "production") {
    setDeploying(true);
    const res = await fetch("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, type }),
    });
    const data = await res.json();
    if (data.url) {
      await fetchSite();
    }
    setDeploying(false);
    if (data.commitSha) {
      pollDeployStatus(data.commitSha);
    }
  }

  async function handleChatSend() {
    if (!chatInput.trim() || chatLoading) return;
    const message = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: message }]);
    setChatLoading(true);

    const res = await fetch("/api/ai-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId,
        message,
        chatHistory: chatMessages,
        page: currentPage,
      }),
    });

    const data = await res.json();
    if (data.changes) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.changes },
      ]);
      // Instant preview — no deploy needed
      if (data.html) {
        revokeBlobUrl();
        const preview = buildBlobPreview(data.html, siteId);
        const blob = new Blob([preview], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setRightTab("preview");
        setPreviewKey((k) => k + 1);
      }
      await fetchSite();
    } else if (data.error) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${data.error}` },
      ]);
    }
    setChatLoading(false);
  }

  async function handleArchive() {
    setArchiving(true);
    await fetch(`/api/sites/${siteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    router.push("/dashboard");
  }

  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true);
    setUploadResult(null);
    setUploadError(null);

    const fd = new FormData();
    fd.append("file", uploadFile);

    try {
      const res = await fetch(`/api/sites/${siteId}/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || "Upload failed");
      } else {
        setUploadResult({ filename: data.filename, url: data.url });
        setUploadFile(null);
      }
    } catch {
      setUploadError("Upload failed — check your connection");
    }
    setUploading(false);
  }

  if (!site) {
    return (
      <div className="p-8">
        <p className="text-gray-500 text-sm">Loading site...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Main content: left sidebar + right panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Site Details / SEO / Images */}
        <div className="w-72 shrink-0 h-full flex flex-col overflow-hidden border-r border-gray-200 bg-white min-w-0">

          {/* Tab bar */}
          <div className="flex shrink-0 border-b border-gray-200 bg-gray-50">
            {(["details", "seo", "images"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setLeftTab(tab);
                  if (tab === "seo" && !seoData) fetchSeo();
                  if (tab === "images" && imgList.length === 0) fetchImages();
                }}
                className={`flex-1 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${
                  leftTab === tab
                    ? "text-zing-teal border-zing-teal bg-white"
                    : "text-gray-400 border-transparent hover:text-gray-600"
                }`}
              >
                {tab === "details" ? "Details" : tab === "seo" ? "SEO" : "Images"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 min-w-0">

          {/* ── DETAILS TAB ── */}
          {leftTab === "details" && (<>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zing-dark">Site Details</h2>
            <button
              onClick={handleExtract}
              disabled={extracting}
              title="Pull current values from the live website HTML"
              className="text-xs text-zing-teal hover:text-zing-dark disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              {extracting ? (
                <span>Reading...</span>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Sync from site
                </>
              )}
            </button>
          </div>

          <div className="space-y-2.5">
            <Field
              label="Business Name"
              value={site.business_name}
              onChange={(v) => setSite({ ...site, business_name: v })}
            />
            <Field
              label="Phone"
              value={site.phone ?? ""}
              onChange={(v) => setSite({ ...site, phone: v })}
            />
            <Field
              label="Contact Email"
              value={site.email ?? ""}
              onChange={(v) => setSite({ ...site, email: v })}
            />
            <Field
              label="Form Routing Email"
              value={site.owner_email ?? ""}
              onChange={(v) => setSite({ ...site, owner_email: v })}
              helpText="Contact form submissions go here"
            />
            <Field
              label="Address"
              value={site.address ?? ""}
              onChange={(v) => setSite({ ...site, address: v })}
            />
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                Hours
              </label>
              <textarea
                value={site.hours ?? ""}
                rows={2}
                onChange={(e) => { setSite({ ...site, hours: e.target.value }); autoGrow(e.target); }}
                ref={el => autoGrow(el)}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal bg-gray-50 focus:bg-white transition-colors resize-none overflow-hidden leading-snug"
              />
            </div>
            <Field
              label="Hero Headline"
              value={site.hero_headline ?? ""}
              onChange={(v) => setSite({ ...site, hero_headline: v })}
            />
            <Field
              label="Hero Subheadline"
              value={site.hero_subheadline ?? ""}
              onChange={(v) => setSite({ ...site, hero_subheadline: v })}
            />
            <Field
              label="CTA Button Text"
              value={site.cta_text ?? ""}
              onChange={(v) => setSite({ ...site, cta_text: v })}
            />
          </div>

          {/* Images Upload */}
          <div className="mt-6">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Images
            </label>
            <div className="flex gap-2">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  setUploadFile(e.target.files?.[0] ?? null);
                  setUploadResult(null);
                  setUploadError(null);
                }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
              />
              <button
                onClick={handleUpload}
                disabled={!uploadFile || uploading}
                className="bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {uploading ? "Uploading..." : "Upload Image"}
              </button>
            </div>
            {uploadResult && (
              <div className="mt-2 bg-green-50 border border-green-200 rounded-md px-3 py-2 text-sm text-green-800">
                <span>&#x2705; {uploadResult.filename} uploaded &mdash; </span>
                <button
                  onClick={() => navigator.clipboard.writeText(uploadResult.url)}
                  className="underline font-medium hover:text-green-900"
                >
                  copy URL
                </button>
                <span className="text-xs text-green-600"> to use in the AI chat</span>
              </div>
            )}
            {uploadError && (
              <p className="mt-2 text-sm text-red-600">{uploadError}</p>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-4 w-full bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>

          {/* Go Live / Custom Domain */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Custom Domain
              </p>
              {domainStatus === "active" && (
                <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Live
                </span>
              )}
              {domainStatus === "pending" && (
                <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
                  Pending DNS
                </span>
              )}
            </div>

            {activeDomain ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
                  <span className="text-sm font-medium text-zing-dark">{activeDomain}</span>
                  <button
                    onClick={handleRemoveDomain}
                    disabled={removingDomain}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    {removingDomain ? "Removing..." : "Remove"}
                  </button>
                </div>

                {domainStatus === "pending" && cnameTarget && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs space-y-1.5">
                    <p className="font-medium text-amber-800">DNS setup required</p>
                    <p className="text-amber-700">Add this CNAME record at your domain registrar:</p>
                    <div className="font-mono bg-white border border-amber-200 rounded px-2 py-1.5 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Type</span>
                        <span className="font-semibold">CNAME</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Name</span>
                        <span className="font-semibold">@</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-500 shrink-0">Target</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(cnameTarget)}
                          className="font-semibold text-zing-teal hover:underline truncate"
                          title="Click to copy"
                        >
                          {cnameTarget}
                        </button>
                      </div>
                    </div>
                    <p className="text-amber-600">Checking every 15s — this page will update automatically once DNS propagates.</p>
                  </div>
                )}

                {domainStatus === "active" && site?.live_url && (
                  <a
                    href={site.live_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-xs text-zing-teal hover:underline"
                  >
                    Open live site ↗
                  </a>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddDomain()}
                    placeholder="e.g. mooreroofingfl.com"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
                  />
                  <button
                    onClick={handleAddDomain}
                    disabled={domainStatus === "adding" || !domainInput.trim()}
                    className="bg-green-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {domainStatus === "adding" ? "Adding..." : "Go Live"}
                  </button>
                </div>
                {domainError && (
                  <p className="text-xs text-red-600">{domainError}</p>
                )}
                <p className="text-xs text-gray-400">
                  Enter the customer&apos;s domain. SSL is provisioned automatically by Cloudflare.
                </p>
              </div>
            )}
          </div>

          {/* Archive section */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Danger Zone
            </p>
            <button
              onClick={() => setShowArchiveModal(true)}
              className="w-full text-center border border-gray-300 text-gray-500 px-3 py-2 rounded-md text-sm hover:bg-gray-50 transition-colors"
            >
              Archive Site
            </button>
          </div>
          </>)}

          {/* ── SEO TAB ── */}
          {leftTab === "seo" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zing-dark">SEO</h2>
                <button onClick={fetchSeo} disabled={seoLoading} className="text-xs text-zing-teal hover:text-zing-dark disabled:opacity-50">
                  {seoLoading ? "Loading..." : "↺ Refresh"}
                </button>
              </div>

              {seoLoading && <p className="text-xs text-gray-400">Loading...</p>}
              {!seoLoading && seoData && (<>
                {/* Title */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Page Title</label>
                    <span className={`text-[10px] ${seoData.title.length > 60 ? "text-red-400" : "text-gray-400"}`}>{seoData.title.length}/60</span>
                  </div>
                  <textarea
                    value={seoData.title}
                    rows={1}
                    onChange={e => { setSeoData({ ...seoData, title: e.target.value }); autoGrow(e.target); }}
                    ref={el => autoGrow(el)}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal resize-none overflow-hidden leading-snug"
                  />
                </div>

                {/* Meta description */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Meta Description</label>
                    <span className={`text-[10px] ${seoData.description.length > 160 ? "text-red-400" : "text-gray-400"}`}>{seoData.description.length}/160</span>
                  </div>
                  <textarea
                    value={seoData.description}
                    rows={2}
                    onChange={e => { setSeoData({ ...seoData, description: e.target.value }); autoGrow(e.target); }}
                    ref={el => autoGrow(el)}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal resize-none overflow-hidden leading-snug"
                  />
                </div>

                {/* Canonical */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Canonical URL</label>
                  <textarea
                    value={seoData.canonical}
                    rows={1}
                    onChange={e => { setSeoData({ ...seoData, canonical: e.target.value }); autoGrow(e.target); }}
                    ref={el => autoGrow(el)}
                    placeholder="https://yourdomain.com/"
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal resize-none overflow-hidden leading-snug"
                  />
                </div>

                {/* H1 (read-only — edit in AI editor) */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">H1 <span className="text-gray-300 normal-case font-normal">(edit in AI Editor)</span></label>
                  <p className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded px-2.5 py-1.5 break-words">{seoData.h1 || "—"}</p>
                </div>

                {/* OG */}
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Open Graph (Social)</p>
                  <div className="space-y-2">
                    <textarea
                      value={seoData.ogTitle}
                      rows={1}
                      onChange={e => { setSeoData({ ...seoData, ogTitle: e.target.value }); autoGrow(e.target); }}
                      ref={el => autoGrow(el)}
                      placeholder="OG Title (defaults to page title)"
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal resize-none overflow-hidden leading-snug"
                    />
                    <textarea
                      value={seoData.ogDescription}
                      rows={2}
                      onChange={e => { setSeoData({ ...seoData, ogDescription: e.target.value }); autoGrow(e.target); }}
                      ref={el => autoGrow(el)}
                      placeholder="OG Description"
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal resize-none overflow-hidden leading-snug"
                    />
                    <textarea
                      value={seoData.ogImage}
                      rows={1}
                      onChange={e => { setSeoData({ ...seoData, ogImage: e.target.value }); autoGrow(e.target); }}
                      ref={el => autoGrow(el)}
                      placeholder="OG Image URL"
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal resize-none overflow-hidden leading-snug"
                    />
                  </div>
                </div>

                <button
                  onClick={saveSeo}
                  disabled={seoSaving}
                  className="w-full bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
                >
                  {seoSaving ? "Saving..." : seoSaved ? "✓ Saved" : "Save SEO"}
                </button>
              </>)}
            </div>
          )}

          {/* ── IMAGES TAB ── */}
          {leftTab === "images" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-zing-dark">Image Alt Text</h2>
                <button onClick={fetchImages} disabled={imgLoading || imgGenerating} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40">
                  {imgLoading ? "Loading..." : "↺"}
                </button>
              </div>
              <p className="text-xs text-gray-400 mb-3">Alt text improves accessibility and image SEO.</p>

              {/* AI Generate All button */}
              {imgList.length > 0 && (
                <button
                  onClick={() => generateAltText()}
                  disabled={imgGenerating || imgLoading}
                  className="w-full mb-4 flex items-center justify-center gap-2 bg-zing-dark text-white px-4 py-2 rounded-md text-xs font-semibold hover:bg-black transition-colors disabled:opacity-50"
                >
                  {imgGenerating ? (
                    <>
                      <span className="animate-spin text-sm">⟳</span>
                      {imgGenProgress ? `${imgGenProgress.done}/${imgGenProgress.total} images...` : "Starting..."}
                    </>
                  ) : (
                    <><span>✨</span> AI Generate All</>
                  )}
                </button>
              )}

              {imgLoading && <p className="text-xs text-gray-400">Loading images...</p>}

              {!imgLoading && imgList.length === 0 && (
                <p className="text-xs text-gray-400">No images found.</p>
              )}

              {!imgLoading && imgList.length > 0 && (
                <div className="space-y-3">
                  {imgList.map((img) => {
                    const isGeneratingThis = imgGeneratingIndex === img.index;
                    return (
                    <div key={img.index} className={`bg-gray-50 border rounded-lg p-2.5 transition-colors ${isGeneratingThis ? "border-zing-teal/50 bg-zing-teal/5" : "border-gray-200"}`}>
                      <div className="flex gap-2.5 mb-2">
                        <img
                          src={img.previewUrl}
                          alt=""
                          className="w-12 h-12 object-cover rounded shrink-0 bg-gray-200"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold text-gray-500 truncate">{img.context}</p>
                          <p className="text-[10px] text-gray-300 truncate">{img.src}</p>
                        </div>
                        {/* Per-image regenerate */}
                        <button
                          onClick={() => generateAltText([img.index])}
                          disabled={imgGenerating}
                          title="Regenerate with AI"
                          className="text-gray-300 hover:text-zing-teal disabled:opacity-30 transition-colors shrink-0 text-sm"
                        >
                          {isGeneratingThis ? <span className="animate-spin inline-block">⟳</span> : "✨"}
                        </button>
                      </div>
                      <input
                        value={img.alt}
                        onChange={e => setImgList(prev => prev.map(i => i.index === img.index ? { ...i, alt: e.target.value } : i))}
                        placeholder={isGeneratingThis ? "Generating..." : "Describe this image..."}
                        disabled={isGeneratingThis}
                        className={`w-full px-2 py-1.5 border border-gray-200 rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-zing-teal disabled:bg-gray-50 disabled:text-gray-400 transition-colors ${img.alt ? "text-gray-800" : "text-gray-400"}`}
                      />
                    </div>
                    );
                  })}

                  <button
                    onClick={saveImages}
                    disabled={imgSaving}
                    className="w-full bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
                  >
                    {imgSaving ? "Saving..." : imgSaved ? "✓ Saved" : `Save Alt Text (${imgList.length} images)`}
                  </button>
                </div>
              )}
            </div>
          )}

          </div>{/* end scrollable content */}
        </div>{/* end left sidebar */}

        {/* Divider */}
        <div className="w-px bg-gray-200 shrink-0" />

        {/* Right: Tabbed Chat / Preview */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">

          {/* Page selector bar */}
          <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 border-b border-gray-200 overflow-x-auto shrink-0">
            {pages.map((p) => (
              <button
                key={p.filename}
                onClick={() => {
                  setCurrentPage(p.filename);
                  setBlobUrl(null);
                  setLocationPreview(null);
                  setSeoData(null);
                  setImgList([]);
                  setChatMessages([]);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors group ${
                  currentPage === p.filename
                    ? "bg-white text-zing-teal shadow-sm border border-gray-200"
                    : "text-gray-500 hover:text-gray-700 hover:bg-white/70"
                }`}
              >
                {p.isHome && <span className="text-[10px]">🏠</span>}
                {p.label}
                {!p.isHome && currentPage === p.filename && (
                  <span
                    onClick={(e) => { e.stopPropagation(); deletePage(p.filename); }}
                    className="ml-1 text-gray-300 hover:text-red-400 transition-colors cursor-pointer text-[10px] leading-none"
                    title={`Delete ${p.filename}`}
                  >✕</span>
                )}
              </button>
            ))}
            {/* New page button */}
            <button
              onClick={() => setShowNewPageModal(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium text-gray-400 hover:text-zing-teal hover:bg-white/70 transition-colors whitespace-nowrap ml-1"
            >
              <span className="text-sm leading-none">+</span> New Page
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex items-center justify-between border-b border-gray-200 bg-white pr-4">
            <div className="flex">
              <button
                onClick={() => setRightTab("chat")}
                className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                  rightTab === "chat"
                    ? "border-zing-teal text-zing-teal"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                AI Editor
              </button>
              <button
                onClick={() => { setRightTab("preview"); setLocationPreview(null); }}
                className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                  rightTab === "preview"
                    ? "border-zing-teal text-zing-teal"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                Preview
              </button>
              <button
                onClick={() => { setRightTab("analytics"); fetchAnalytics(); }}
                className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                  rightTab === "analytics"
                    ? "border-zing-teal text-zing-teal"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                Analytics
              </button>
            </div>

            {/* Device toggle — only when on Preview tab */}
            {rightTab === "preview" && (
              <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
                {(["desktop", "tablet", "mobile"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDeviceView(d)}
                    title={d.charAt(0).toUpperCase() + d.slice(1)}
                    className={`px-2 py-1 rounded text-gray-500 transition-colors ${
                      deviceView === d
                        ? "bg-white shadow-sm text-zing-dark"
                        : "hover:text-gray-700"
                    }`}
                  >
                    {d === "desktop" && (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="2" y="3" width="20" height="14" rx="2" strokeWidth="2" strokeLinecap="round"/>
                        <path d="M8 21h8M12 17v4" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    )}
                    {d === "tablet" && (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="4" y="2" width="16" height="20" rx="2" strokeWidth="2" strokeLinecap="round"/>
                        <circle cx="12" cy="18" r="1" fill="currentColor"/>
                      </svg>
                    )}
                    {d === "mobile" && (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="7" y="2" width="10" height="20" rx="2" strokeWidth="2" strokeLinecap="round"/>
                        <circle cx="12" cy="18" r="1" fill="currentColor"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Chat panel */}
          {rightTab === "chat" && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatMessages.length === 0 && (
                  <p className="text-sm text-gray-400 text-center mt-8">
                    No messages yet. Describe a change to get started.
                  </p>
                )}
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                        msg.role === "user"
                          ? "bg-zing-teal text-white"
                          : "bg-white border border-gray-200 text-gray-800"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-500">
                      Pixel is editing...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="px-4 py-3 border-t border-gray-200 bg-white">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleChatSend()}
                    placeholder="Describe a change..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal bg-gray-50 focus:bg-white transition-colors"
                  />
                  <button
                    onClick={handleChatSend}
                    disabled={chatLoading || !chatInput.trim()}
                    className="bg-zing-teal text-white px-4 py-2 rounded text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50 shrink-0"
                  >
                    {chatLoading ? "..." : "Send"}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Preview panel */}
          {rightTab === "preview" && (
            <div className="flex-1 flex flex-col">
              {site.preview_url ? (
                <>
                  <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
                    <div className="flex items-center gap-2 min-w-0">
                      {blobUrl ? (
                        <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                          ⚡ Unsaved preview
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                          ✓ Deployed
                        </span>
                      )}
                      <span className="text-xs text-gray-400 truncate">
                        {blobUrl ? "Changes not yet deployed to Cloudflare" : site.preview_url}
                      </span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {blobUrl && (
                        <button
                          onClick={revokeBlobUrl}
                          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
                          title="Switch back to the deployed version"
                        >
                          Show deployed
                        </button>
                      )}
                      <button
                        onClick={() => setPreviewKey((k) => k + 1)}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
                      >
                        ↻ Refresh
                      </button>
                      {!blobUrl && site.preview_url && (
                        <a
                          href={site.preview_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-zing-teal hover:underline px-2 py-1"
                        >
                          Open ↗
                        </a>
                      )}
                    </div>
                  </div>
                  {/* Device frame + iframe */}
                  <div className="flex-1 overflow-auto bg-gray-100 flex items-start justify-center">
                    {deviceView === "desktop" ? (
                      <iframe
                        key={`${previewKey}-desktop-${locationPreview ?? ""}`}
                        src={locationPreview ?? blobUrl ?? site.preview_url ?? ""}
                        className="w-full h-full border-0 bg-white"
                        style={{ minHeight: "100%" }}
                        title="Site Preview"
                      />
                    ) : (
                      <div
                        className="my-4 shrink-0 relative"
                        style={{
                          width: deviceView === "tablet" ? 768 : 375,
                        }}
                      >
                        {/* Device chrome */}
                        <div
                          className={`rounded-2xl overflow-hidden shadow-xl border-4 ${
                            deviceView === "tablet"
                              ? "border-gray-700 rounded-2xl"
                              : "border-gray-800 rounded-3xl"
                          }`}
                        >
                          {/* Status bar strip */}
                          <div className="bg-gray-800 h-6 flex items-center justify-center">
                            <div className={`bg-gray-600 rounded-full ${
                              deviceView === "tablet" ? "w-12 h-1" : "w-20 h-1.5"
                            }`} />
                          </div>
                          <iframe
                            key={`${previewKey}-${deviceView}`}
                            src={blobUrl ?? site.preview_url ?? ""}
                            className="block border-0 bg-white"
                            style={{
                              width: deviceView === "tablet" ? 760 : 367,
                              height: deviceView === "tablet" ? 960 : 700,
                            }}
                            title="Site Preview"
                          />
                          {/* Home bar */}
                          <div className="bg-gray-800 h-6 flex items-center justify-center">
                            <div className="bg-gray-600 rounded-full w-16 h-1" />
                          </div>
                        </div>
                        {/* Size label */}
                        <p className="text-center text-xs text-gray-400 mt-2">
                          {deviceView === "tablet" ? "768px — Tablet" : "375px — Mobile"}
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-sm text-gray-400">
                    No preview URL yet. Click Deploy Preview to generate one.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Analytics panel */}
          {rightTab === "analytics" && (
            <div className="flex-1 overflow-y-auto bg-gray-50 p-5">
              {analyticsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <p className="text-sm text-gray-400">Loading analytics...</p>
                </div>
              ) : !analyticsData ? (
                <div className="flex items-center justify-center h-32">
                  <p className="text-sm text-gray-400">No analytics data yet.</p>
                </div>
              ) : (
                <div className="space-y-4 max-w-2xl">
                  {/* Headline stats */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Page Views (30d)</p>
                      <p className="text-2xl font-bold text-zing-dark">{analyticsData.pageviews.toLocaleString()}</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Visits (30d)</p>
                      <p className="text-2xl font-bold text-zing-dark">{analyticsData.visits.toLocaleString()}</p>
                    </div>
                  </div>

                  {/* Daily sparkline */}
                  {analyticsData.daily.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Daily Page Views</p>
                      <div className="flex items-end gap-0.5 h-20">
                        {(() => {
                          const max = Math.max(...analyticsData.daily.map((d) => d.pageviews), 1);
                          return analyticsData.daily.map((d) => (
                            <div
                              key={d.date}
                              className="flex-1 bg-zing-teal/70 rounded-sm hover:bg-zing-teal transition-colors"
                              style={{ height: `${Math.max(4, (d.pageviews / max) * 100)}%` }}
                              title={`${d.date}: ${d.pageviews} views`}
                            />
                          ));
                        })()}
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-[10px] text-gray-400">{analyticsData.daily[0]?.date}</span>
                        <span className="text-[10px] text-gray-400">{analyticsData.daily[analyticsData.daily.length - 1]?.date}</span>
                      </div>
                    </div>
                  )}

                  {/* Countries + Referrers side by side */}
                  <div className="grid grid-cols-2 gap-3">
                    {analyticsData.countries.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Top Countries</p>
                        <div className="space-y-1.5">
                          {analyticsData.countries.map((c) => (
                            <div key={c.name} className="flex justify-between text-xs">
                              <span className="text-gray-700 truncate">{c.name}</span>
                              <span className="text-gray-500 font-medium shrink-0 ml-2">{c.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {analyticsData.referrers.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Top Referrers</p>
                        <div className="space-y-1.5">
                          {analyticsData.referrers.map((r) => (
                            <div key={r.host} className="flex justify-between text-xs">
                              <span className="text-gray-700 truncate">{r.host || "Direct"}</span>
                              <span className="text-gray-500 font-medium shrink-0 ml-2">{r.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Devices */}
                  {analyticsData.devices.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Devices</p>
                      <div className="flex gap-4">
                        {analyticsData.devices.map((d) => {
                          const total = analyticsData.devices.reduce((s, x) => s + x.count, 0);
                          return (
                            <div key={d.type} className="flex items-center gap-1.5 text-xs">
                              <span className="capitalize text-gray-700 font-medium">{d.type || "other"}</span>
                              <span className="text-gray-400">{total > 0 ? Math.round((d.count / total) * 100) : 0}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-gray-400">
                    Data from Cloudflare Analytics · {analyticsData.pageviews === 0 ? "No traffic yet — analytics will appear once visitors arrive." : "Last 30 days"}
                  </p>
                </div>
              )}
            </div>
          )}

      {/* Bottom bar */}
      <div className="border-t border-gray-200 bg-white px-5 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {site.preview_url ? (
            <a
              href={site.preview_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zing-teal hover:underline truncate max-w-[220px]"
            >
              {site.preview_url}
            </a>
          ) : (
            <span className="text-xs text-gray-400">No preview yet</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Deploy status badge */}
          {deployState === "queued" && (
            <span className="text-xs text-amber-600 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Queued...
            </span>
          )}
          {deployState === "in_progress" && (
            <span className="text-xs text-blue-600 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              Deploying to Cloudflare...
            </span>
          )}
          {deployState === "success" && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              ✅ Deploy complete
            </span>
          )}
          {deployState === "failure" && (
            <span className="text-xs text-red-600 flex items-center gap-1">
              ❌ Deploy failed
            </span>
          )}
          {deploying && deployState === "idle" && (
            <span className="text-xs text-gray-500">Committing...</span>
          )}

          <button
            onClick={() => handleDeploy("preview")}
            disabled={deploying || deployState === "in_progress" || deployState === "queued"}
            className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded text-xs font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            Preview
          </button>
          <button
            onClick={() => handleDeploy("production")}
            disabled={deploying || deployState === "in_progress" || deployState === "queued"}
            className="bg-zing-teal text-white px-4 py-1.5 rounded text-xs font-semibold hover:bg-zing-dark transition-colors disabled:opacity-50"
          >
            Push to Production
          </button>
          {currentPage === "index.html" && (
            <button
              onClick={() => setShowLocModal(true)}
              className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded text-xs font-medium hover:bg-gray-200 transition-colors flex items-center gap-1.5"
            >
              📍 Generate Locations
            </button>
          )}
        </div>
        </div>
        </div>
      </div>

      {/* Bottom panel: Deployments / Activity / Versions / Locations */}
      <div className="h-48 shrink-0 flex flex-col bg-white border-t border-gray-200">
        <div className="flex gap-0.5 px-5 border-b border-gray-200">
          {(["deployments", "activity", "versions", "locations"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setBottomTab(tab);
                if (tab === "versions") fetchVersions();
                if (tab === "locations") fetchLocations();
              }}
              className={`px-3 py-2.5 text-[11px] font-medium capitalize transition-colors flex items-center gap-1.5 ${
                bottomTab === tab
                  ? "text-zing-teal border-b-2 border-zing-teal"
                  : "text-gray-400 hover:text-gray-600 border-b-2 border-transparent"
              }`}
            >
              {tab}
              {tab === "deployments" && deployments.length > 0 && (
                <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${bottomTab === "deployments" ? "bg-zing-teal/10 text-zing-teal" : "bg-gray-100 text-gray-500"}`}>{deployments.length}</span>
              )}
              {tab === "activity" && editLog.length > 0 && (
                <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${bottomTab === "activity" ? "bg-zing-teal/10 text-zing-teal" : "bg-gray-100 text-gray-500"}`}>{editLog.length}</span>
              )}
              {tab === "locations" && locations.length > 0 && (
                <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${bottomTab === "locations" ? "bg-zing-teal/10 text-zing-teal" : "bg-gray-100 text-gray-500"}`}>{locations.length}</span>
              )}

            </button>
          ))}
        </div>

        <div className="px-5 py-2.5 flex-1 overflow-y-auto text-xs">
          {bottomTab === "deployments" && (
            deployments.length === 0 ? (
              <p className="text-xs text-gray-400">No deployments yet.</p>
            ) : (
              <div className="space-y-1.5">
                {deployments.map((dep) => (
                  <div key={dep.id} className="flex items-center gap-3 text-xs text-gray-500">
                    <span className={`font-medium w-20 shrink-0 ${
                      dep.type === "production" ? "text-green-600" : dep.type === "rollback" ? "text-purple-600" : "text-amber-600"
                    }`}>
                      {dep.type}
                    </span>
                    {dep.url && (
                      <a href={dep.url} target="_blank" rel="noopener noreferrer"
                        className="text-zing-teal hover:underline truncate max-w-xs">
                        {dep.url}
                      </a>
                    )}
                    <span className="shrink-0">
                      {new Date(dep.deployed_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                    </span>
                    {dep.deployed_by && (
                      <span className="text-gray-400 shrink-0">by {dep.deployed_by.split("@")[0]}</span>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {bottomTab === "activity" && (
            editLog.length === 0 ? (
              <p className="text-xs text-gray-400">No edit activity yet.</p>
            ) : (
              <div className="space-y-1.5">
                {editLog.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 text-xs text-gray-500">
                    <span className={`font-medium shrink-0 ${
                      entry.action === "ai_edit" ? "text-zing-teal" : "text-gray-600"
                    }`}>
                      {entry.action === "ai_edit" ? "AI" : "Field"}
                    </span>
                    <span className="flex-1 truncate" title={entry.summary}>{entry.summary}</span>
                    <span className="shrink-0 text-gray-400">
                      {new Date(entry.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                    </span>
                    {entry.user_email && (
                      <span className="text-gray-400 shrink-0">
                        {entry.user_email.split("@")[0]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {bottomTab === "versions" && (
            versionsLoading ? (
              <p className="text-xs text-gray-400">Loading...</p>
            ) : versions.length === 0 ? (
              <p className="text-xs text-gray-400">No version history yet.</p>
            ) : (
              <div className="space-y-1.5">
                {versions.map((v, i) => (
                  <div key={v.sha} className="flex items-center gap-3 text-xs text-gray-500">
                    <span className="font-mono text-gray-400 w-14 shrink-0">{v.sha.slice(0, 7)}</span>
                    <span className="flex-1 truncate" title={v.message}>
                      {i === 0 && <span className="text-green-600 font-medium">current — </span>}
                      {v.message}
                    </span>
                    <span className="shrink-0 text-gray-400">
                      {new Date(v.date).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                    </span>
                    {i > 0 && (
                      <button
                        onClick={() => handleRollback(v.sha)}
                        disabled={rollingBack === v.sha}
                        className="shrink-0 text-xs text-amber-600 hover:text-amber-800 font-medium disabled:opacity-50"
                      >
                        {rollingBack === v.sha ? "Restoring..." : "Restore"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {/* Locations panel */}
          {bottomTab === "locations" && (
            locationsLoading ? (
              <p className="text-xs text-gray-400">Loading location pages...</p>
            ) : locations.length === 0 ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-gray-400">No location pages generated yet.</p>
                <p className="text-xs text-gray-400">Run: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">node scripts/generate-locations.js --site {siteId} --city &quot;City&quot; --state ST</code></p>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{locations.length} location pages</span>
                  {locationsMeta?.indexUrl && (
                    <a href={locationsMeta.indexUrl} target="_blank" rel="noopener" className="text-[10px] text-zing-teal hover:underline">View all →</a>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {locations.map((loc) => (
                    <div key={loc.slug} className="flex items-center justify-between gap-2 py-0.5">
                      <button
                        onClick={() => { setLocationPreview(loc.url); setRightTab("preview"); }}
                        className="text-xs text-gray-700 hover:text-zing-teal truncate text-left"
                        title={loc.label}
                      >
                        {loc.label}
                      </button>
                      <a href={loc.url} target="_blank" rel="noopener" className="text-[10px] text-gray-300 hover:text-zing-teal shrink-0">↗</a>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* New Page modal */}
      {showNewPageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-sm font-semibold text-zing-dark">New Page</h3>
                <p className="text-xs text-gray-400 mt-0.5">Add a page to this site</p>
              </div>
              <button onClick={() => { setShowNewPageModal(false); setNewPageError(""); }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Page Name</label>
                <input
                  value={newPageName}
                  onChange={e => {
                    setNewPageName(e.target.value);
                    setNewPageSlug(e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
                  }}
                  placeholder="e.g. Services"
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">URL Slug</label>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">/</span>
                  <input
                    value={newPageSlug}
                    onChange={e => setNewPageSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="services"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal"
                  />
                  <span className="text-xs text-gray-400">/</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Copy Layout From</label>
                <select
                  value={newPageCloneFrom}
                  onChange={e => setNewPageCloneFrom(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal"
                >
                  {pages.map(p => (
                    <option key={p.filename} value={p.filename}>{p.label} ({p.filename})</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-1">Copies the nav, header, footer, and styles. AI will update the page title and H1.</p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newPageAddToNav}
                  onChange={e => setNewPageAddToNav(e.target.checked)}
                  className="mt-0.5 accent-zing-teal"
                />
                <div>
                  <p className="text-sm font-medium text-gray-700">Add to nav on all pages</p>
                  <p className="text-xs text-gray-400">AI will insert this page into the navigation bar on every existing page. Takes ~30s.</p>
                </div>
              </label>

              {newPageError && <p className="text-xs text-red-500">{newPageError}</p>}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <button onClick={() => { setShowNewPageModal(false); setNewPageError(""); }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
              <button
                onClick={createPage}
                disabled={newPageCreating || !newPageName.trim() || !newPageSlug.trim()}
                className="bg-zing-teal text-white px-5 py-2 rounded-lg text-xs font-semibold hover:bg-zing-dark transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {newPageCreating
                  ? <><span className="animate-spin">⟳</span> {newPageAddToNav ? "Creating + updating nav..." : "Creating..."}</>
                  : "Create Page"
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generate Locations modal */}
      {showLocModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col" style={{ maxHeight: "80vh" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-zing-dark">📍 Generate Location Pages</h3>
                <p className="text-xs text-gray-400 mt-0.5">Creates 50 SEO landing pages targeting nearby cities</p>
              </div>
              <button onClick={() => { if (!locRunning) setShowLocModal(false); }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>

            {/* Form */}
            {!locRunning && !locDone && (
              <div className="px-6 py-5 space-y-4 shrink-0">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Base City</label>
                    <input
                      value={locCity}
                      onChange={e => setLocCity(e.target.value)}
                      placeholder="Orange Park"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">State</label>
                    <input
                      value={locState}
                      onChange={e => setLocState(e.target.value.toUpperCase().slice(0, 2))}
                      placeholder="FL"
                      maxLength={2}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal uppercase"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Number of Pages</label>
                  <select
                    value={locCount}
                    onChange={e => setLocCount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal"
                  >
                    <option value="25">25 pages</option>
                    <option value="50">50 pages (recommended)</option>
                    <option value="75">75 pages</option>
                    <option value="100">100 pages</option>
                  </select>
                </div>
                <p className="text-[11px] text-gray-400">Cities are selected by population × proximity — larger nearby cities rank first. Pages deploy automatically via GitHub Actions.</p>
              </div>
            )}

            {/* Progress log */}
            {(locRunning || locLog.length > 0) && (
              <div className="flex-1 overflow-y-auto px-6 py-3 font-mono text-[11px] space-y-0.5 bg-gray-50 border-t border-gray-100 min-h-0">
                {locLog.map((entry, i) => (
                  <div key={i} className={`leading-5 ${entry.type === "done" ? "text-green-600 font-semibold mt-2" : entry.type === "error" ? "text-red-500" : entry.status === "error" ? "text-red-400" : "text-gray-600"}`}>
                    {entry.text}
                  </div>
                ))}
                {locRunning && <div className="text-gray-400 animate-pulse">Running…</div>}
              </div>
            )}

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between shrink-0">
              {locDone ? (
                <>
                  <button onClick={() => { setShowLocModal(false); setLocLog([]); setLocDone(false); setBottomTab("locations"); }} className="text-xs text-zing-teal hover:underline">View in Locations tab →</button>
                  <button onClick={() => { setLocLog([]); setLocDone(false); }} className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200">Run again</button>
                </>
              ) : (
                <>
                  <button onClick={() => setShowLocModal(false)} disabled={locRunning} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40">Cancel</button>
                  <button
                    onClick={runGenerateLocations}
                    disabled={locRunning || !locCity.trim() || !locState.trim()}
                    className="bg-zing-teal text-white px-5 py-2 rounded-lg text-xs font-semibold hover:bg-zing-dark transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {locRunning ? <><span className="animate-spin">⟳</span> Generating…</> : "Generate Pages"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Archive confirmation modal */}
      {showArchiveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-zing-dark mb-2">
              Archive {site.business_name}?
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              The site will be hidden from Pixel. Files and deployment are not
              affected.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowArchiveModal(false)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="flex-1 bg-gray-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {archiving ? "Archiving..." : "Archive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function Field({
  label,
  value,
  onChange,
  helpText,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  helpText?: string;
}) {
  return (
    <div className="min-w-0">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1 truncate" title={label}>
        {label}
      </label>
      <textarea
        value={value}
        rows={1}
        onChange={(e) => { onChange(e.target.value); autoGrow(e.target); }}
        ref={(el) => autoGrow(el)}
        className="w-full min-w-0 px-2.5 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal bg-gray-50 focus:bg-white transition-colors resize-none overflow-hidden leading-snug"
      />
      {helpText && (
        <p className="text-xs text-gray-400 mt-0.5 break-words">{helpText}</p>
      )}
    </div>
  );
}
