const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;

export async function createPagesProject(siteId: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: siteId,
        production_branch: "main",
      }),
    }
  );
  return res.json();
}
