#!/usr/bin/env bun

interface CloudflareRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
}

interface CloudflareResponse {
  success: boolean;
  errors: any[];
  messages: any[];
  result: CloudflareRecord[];
}

const ZONE_ID = process.env.ZONE_ID!;
const API_TOKEN = process.env.API_TOKEN!;

const headers = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Content-Type': 'application/json'
};

async function listDNSRecords(): Promise<CloudflareRecord[]> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`, {
    headers
  });

  const data: CloudflareResponse = await response.json();

  if (!data.success) {
    throw new Error(`Failed to list DNS records: ${JSON.stringify(data.errors)}`);
  }

  return data.result;
}

async function createDNSRecord(type: string, name: string, content: string, proxied: boolean = true): Promise<void> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type,
      name,
      content,
      proxied,
      ttl: 1 // Auto when proxied
    })
  });

  const data: CloudflareResponse = await response.json();

  if (!data.success) {
    throw new Error(`Failed to create DNS record: ${JSON.stringify(data.errors)}`);
  }

  console.log(`✅ Created ${type} record: ${name} → ${content} (proxied: ${proxied})`);
}

async function updateDNSRecord(recordId: string, type: string, name: string, content: string, proxied: boolean = true): Promise<void> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${recordId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      type,
      name,
      content,
      proxied,
      ttl: 1 // Auto when proxied
    })
  });

  const data: CloudflareResponse = await response.json();

  if (!data.success) {
    throw new Error(`Failed to update DNS record: ${JSON.stringify(data.errors)}`);
  }

  console.log(`✅ Updated ${type} record: ${name} → ${content} (proxied: ${proxied})`);
}

async function main() {
  try {
    console.log('🔍 Fetching current DNS records...');
    const records = await listDNSRecords();

    console.log('\n📋 Current DNS Records:');
    records.forEach(record => {
      console.log(`  ${record.type.padEnd(6)} ${record.name.padEnd(25)} → ${record.content} ${record.proxied ? '(proxied)' : ''}`);
    });

    // Check if www.ubq.fi already exists
    const wwwRecord = records.find(r => r.name === 'www.ubq.fi');
    const rootRecord = records.find(r => r.name === 'ubq.fi');

    if (!rootRecord) {
      console.log('\n❌ Root domain ubq.fi not found in DNS records');
      return;
    }

    console.log(`\n🎯 Root domain (ubq.fi) points to: ${rootRecord.content}`);

    if (wwwRecord) {
      console.log(`\n📝 www.ubq.fi already exists, pointing to: ${wwwRecord.content}`);

      // Check if it's pointing to the right place
      if (wwwRecord.content !== 'ubq.fi' && wwwRecord.content !== rootRecord.content) {
        console.log('🔄 Updating www.ubq.fi to point to ubq.fi...');
        await updateDNSRecord(wwwRecord.id, 'CNAME', 'www.ubq.fi', 'ubq.fi', true);
      } else {
        console.log('✅ www.ubq.fi is already configured correctly');
      }
    } else {
      console.log('\n➕ Creating CNAME record for www.ubq.fi → ubq.fi...');
      await createDNSRecord('CNAME', 'www.ubq.fi', 'ubq.fi', true);
    }

    console.log('\n🎉 DNS update complete!');
    console.log('\n⏱️ Note: DNS changes may take a few minutes to propagate');
    console.log('🌐 Test: https://www.ubq.fi should now work');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the main function if this script is executed directly
main();
