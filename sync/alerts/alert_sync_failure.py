#!/usr/bin/env python3
"""Send a Teams Adaptive Card alert when a sync pipeline step fails.

Expected environment variables:
  TEAMS_WEBHOOK_URL      - Power Automate webhook URL (required)
  ALERT_DISPLAY_NAME     - e.g. "Sync Failed: Sync Server List from Databricks"
  ALERT_PIPELINE_INFO    - e.g. "Pipeline: ops-sync-servers | Run #42"
"""

import json
import os
import sys
import urllib.request


def main():
    webhook_url = os.environ.get("TEAMS_WEBHOOK_URL")
    if not webhook_url:
        print("TEAMS_WEBHOOK_URL not set — skipping alert")
        return

    display_name = os.environ.get("ALERT_DISPLAY_NAME", "Sync failed")
    pipeline_info = os.environ.get("ALERT_PIPELINE_INFO", "")

    card = {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": [
                    {
                        "type": "TextBlock",
                        "weight": "bolder",
                        "color": "attention",
                        "text": display_name,
                    },
                    {
                        "type": "TextBlock",
                        "wrap": True,
                        "text": pipeline_info,
                    },
                    {
                        "type": "TextBlock",
                        "wrap": True,
                        "isSubtle": True,
                        "text": "Check Azure DevOps for the full error log.",
                    },
                ],
            },
        }],
    }

    req = urllib.request.Request(
        webhook_url,
        data=json.dumps(card).encode(),
        headers={"Content-Type": "application/json"},
    )
    urllib.request.urlopen(req, timeout=15)
    print("Teams failure alert sent")


if __name__ == "__main__":
    main()
