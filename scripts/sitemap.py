#!/usr/bin/env python3
"""
Dynamic Sitemap Generator for Apps & Plugins
生成符合 sitemap.org 规范的 XML 站点地图
"""

import json
from datetime import datetime
from typing import List, Dict
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom import minidom

class SitemapGenerator:
    def __init__(self, base_url: str = "https://ubq.fi"):
        self.base_url = base_url
        self.urls: List[Dict] = []

    def add_app(self, app_id: str, name: str, updated: datetime = None, priority: float = 0.8):
        """添加 App 页面"""
        self.urls.append({
            "loc": f"{self.base_url}/apps/{app_id}",
            "lastmod": (updated or datetime.now()).strftime("%Y-%m-%d"),
            "changefreq": "weekly",
            "priority": priority,
            "type": "app",
            "name": name
        })

    def add_plugin(self, plugin_id: str, name: str, updated: datetime = None, priority: float = 0.7):
        """添加 Plugin 页面"""
        self.urls.append({
            "loc": f"{self.base_url}/plugins/{plugin_id}",
            "lastmod": (updated or datetime.now()).strftime("%Y-%m-%d"),
            "changefreq": "weekly",
            "priority": priority,
            "type": "plugin",
            "name": name
        })

    def generate_xml(self) -> str:
        """生成 XML 站点地图"""
        urlset = Element('urlset')
        urlset.set('xmlns', 'http://www.sitemaps.org/schemas/sitemap/0.9')

        for url_data in self.urls:
            url = SubElement(urlset, 'url')

            loc = SubElement(url, 'loc')
            loc.text = url_data['loc']

            lastmod = SubElement(url, 'lastmod')
            lastmod.text = url_data['lastmod']

            changefreq = SubElement(url, 'changefreq')
            changefreq.text = url_data['changefreq']

            priority = SubElement(url, 'priority')
            priority.text = str(url_data['priority'])

        # 美化输出
        rough_string = tostring(urlset, encoding='unicode')
        reparsed = minidom.parseString(rough_string)
        return reparsed.toprettyxml(indent="  ")

    def generate_json(self) -> str:
        """生成 JSON 格式（供前端使用）"""
        return json.dumps({
            "generated_at": datetime.now().isoformat(),
            "total_urls": len(self.urls),
            "urls": self.urls
        }, indent=2)


def main():
    # 示例：生成站点地图
    generator = SitemapGenerator()

    # 添加 Apps
    apps = [
        ("payment-processor", "Payment Processor"),
        ("wallet-connect", "Wallet Connect"),
        ("nft-minter", "NFT Minter"),
    ]

    for app_id, name in apps:
        generator.add_app(app_id, name)

    # 添加 Plugins
    plugins = [
        ("analytics", "Analytics Plugin"),
        ("auth-connector", "Auth Connector"),
        ("ipfs-uploader", "IPFS Uploader"),
    ]

    for plugin_id, name in plugins:
        generator.add_plugin(plugin_id, name)

    # 生成 XML
    xml_output = generator.generate_xml()
    print(xml_output)

    # 保存到文件
    with open("sitemap.xml", "w", encoding="utf-8") as f:
        f.write(xml_output)

    print("\n✅ sitemap.xml generated")


if __name__ == "__main__":
    main()
