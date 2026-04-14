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
  const [bottomTab, setBottomTab] = useState<"deployments" | "activity" | "versions">("deployments");

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
  const [rightTab, setRightTab] = useState<"chat" | "preview">("chat");
  const [previewKey, setPreviewKey] = useState(0); // increment to force iframe reload

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

  async function fetchVersions() {
    setVersionsLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/versions`);
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
        body: JSON.stringify({ sha }),
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
    <div className="flex flex-col h-screen">
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Structured Fields */}
        <div className="w-72 shrink-0 border-r border-gray-200 overflow-y-auto p-5 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-zing-dark">Site Details</h2>
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

          <div className="space-y-3">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Hours
              </label>
              <textarea
                value={site.hours ?? ""}
                onChange={(e) => setSite({ ...site, hours: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
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
        </div>

        {/* Right: Tabbed Chat / Preview */}
        <div className="flex-1 flex flex-col bg-gray-50">
          {/* Tab bar */}
          <div className="flex border-b border-gray-200 bg-white">
            <button
              onClick={() => setRightTab("chat")}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                rightTab === "chat"
                  ? "border-zing-teal text-zing-teal"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              AI Editor
            </button>
            <button
              onClick={() => setRightTab("preview")}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                rightTab === "preview"
                  ? "border-zing-teal text-zing-teal"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Preview
            </button>
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

              <div className="p-4 border-t border-gray-200 bg-white">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleChatSend()}
                    placeholder="Describe a change..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
                  />
                  <button
                    onClick={handleChatSend}
                    disabled={chatLoading || !chatInput.trim()}
                    className="bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
                  >
                    Send
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
                  <iframe
                    key={previewKey}
                    src={blobUrl ?? site.preview_url ?? ""}
                    className="flex-1 w-full border-0"
                    title="Site Preview"
                  />
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
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-gray-200 bg-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {site.preview_url && (
            <a
              href={site.preview_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-zing-teal hover:underline"
            >
              {site.preview_url}
            </a>
          )}
          {site.preview_url && (
            <a
              href={site.preview_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs bg-gray-100 text-gray-700 px-3 py-1 rounded hover:bg-gray-200 transition-colors"
            >
              Open Preview
            </a>
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
            className="bg-gray-100 text-gray-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            Deploy Preview
          </button>
          <button
            onClick={() => handleDeploy("production")}
            disabled={deploying || deployState === "in_progress" || deployState === "queued"}
            className="bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
          >
            🚀 Push to Production
          </button>
        </div>
      </div>

      {/* Bottom tabs: Deployments / Activity / Versions */}
      <div className="border-t border-gray-200 bg-gray-50">
        <div className="flex gap-1 px-6 pt-3 border-b border-gray-200">
          {(["deployments", "activity", "versions"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setBottomTab(tab); if (tab === "versions") fetchVersions(); }}
              className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                bottomTab === tab
                  ? "text-zing-teal border-b-2 border-zing-teal -mb-px bg-white rounded-t"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab}
              {tab === "deployments" && deployments.length > 0 && (
                <span className="ml-1 text-gray-400">({deployments.length})</span>
              )}
              {tab === "activity" && editLog.length > 0 && (
                <span className="ml-1 text-gray-400">({editLog.length})</span>
              )}
            </button>
          ))}
        </div>

        <div className="px-6 py-3 max-h-48 overflow-y-auto">
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
        </div>
      </div>

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
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
      />
      {helpText && (
        <p className="text-xs text-gray-400 mt-0.5">{helpText}</p>
      )}
    </div>
  );
}
