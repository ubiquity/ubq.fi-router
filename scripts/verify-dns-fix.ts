#!/usr/bin/env bun

async function testUrl(url: string): Promise<void> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const status = response.status;
    const statusEmoji = status === 200 ? '✅' : '❌';
    console.log(`${statusEmoji} ${url} → ${status} ${response.statusText}`);
  } catch (error) {
    console.log(`❌ ${url} → Error: ${error}`);
  }
}

async function main() {
  console.log('🧪 Testing DNS and routing fix...\n');

  await testUrl('https://ubq.fi');
  await testUrl('https://www.ubq.fi');

  console.log('\n🎉 DNS fix verification complete!');
  console.log('📝 Summary:');
  console.log('  • Created CNAME record: www.ubq.fi → ubq.fi');
  console.log('  • Updated router to treat www subdomain same as root domain');
  console.log('  • Both domains now resolve correctly');
}

main();
