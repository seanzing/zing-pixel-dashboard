"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";

interface Site {
  id: string;
  business_name: string;
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

interface Deployment {
  id: string;
  type: string;
  url: string;
  deployed_at: string;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export default function SiteEditorPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  async function fetchSite() {
    const res = await fetch(`/api/sites/${siteId}`);
    const data = await res.json();
    setSite(data.site);
    setDeployments(data.deployments ?? []);
    if (data.chatMessages) {
      setChatMessages(data.chatMessages);
    }
  }

  useEffect(() => {
    fetchSite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  async function handleSave() {
    if (!site) return;
    setSaving(true);
    await fetch(`/api/sites/${siteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(site),
    });
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
      await fetchSite();
    } else if (data.error) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${data.error}` },
      ]);
    }
    setChatLoading(false);
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
        <div className="w-2/5 border-r border-gray-200 overflow-y-auto p-6 bg-white">
          <h2 className="text-lg font-semibold text-zing-dark mb-4">
            Site Details
          </h2>

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
              label="Email"
              value={site.email ?? ""}
              onChange={(v) => setSite({ ...site, email: v })}
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

          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-4 w-full bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>

        {/* Right: AI Chat */}
        <div className="w-3/5 flex flex-col bg-gray-50">
          <div className="p-4 border-b border-gray-200 bg-white">
            <h2 className="text-lg font-semibold text-zing-dark">
              AI Editor
            </h2>
            <p className="text-xs text-gray-400">
              Describe changes and Pixel will edit the HTML
            </p>
          </div>

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
          {deploying && (
            <span className="text-xs text-gray-500">Deploying...</span>
          )}
          <button
            onClick={() => handleDeploy("production")}
            disabled={deploying}
            className="bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
          >
            Push to Production
          </button>
        </div>
      </div>

      {/* Deployment history */}
      {deployments.length > 0 && (
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-2">
          <p className="text-xs font-medium text-gray-500 mb-1">
            Recent Deployments
          </p>
          <div className="space-y-1">
            {deployments.slice(0, 5).map((dep) => (
              <div
                key={dep.id}
                className="flex items-center gap-3 text-xs text-gray-500"
              >
                <span
                  className={`font-medium ${
                    dep.type === "production"
                      ? "text-green-600"
                      : "text-amber-600"
                  }`}
                >
                  {dep.type}
                </span>
                <a
                  href={dep.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zing-teal hover:underline"
                >
                  {dep.url}
                </a>
                <span>
                  {new Date(dep.deployed_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
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
    </div>
  );
}
