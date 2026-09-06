"use client";

import React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OmniPageHeader } from "@/components/shared/omni-page-header";
import { ApplicationsTab } from "@/components/developer/applications-tab";
import { ApiKeysTab } from "@/components/developer/api-keys-tab";
import { WebhooksTab } from "@/components/developer/webhooks-tab";
import { ApiLogsTab } from "@/components/developer/api-logs-tab";
import { DocumentationTab } from "@/components/developer/documentation-tab";

export function OmniDeveloperView({
  canManageApplications,
  canManageKeys,
  canManageWebhooks,
}: {
  canManageApplications: boolean;
  canManageKeys: boolean;
  canManageWebhooks: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <OmniPageHeader title="Developers" description="Applications, API keys, webhooks, request logs, and API reference." />

      <Tabs defaultValue="applications">
        <TabsList>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="logs">API Logs</TabsTrigger>
          <TabsTrigger value="docs">Documentation</TabsTrigger>
        </TabsList>

        <TabsContent value="applications" className="mt-4">
          <ApplicationsTab canManage={canManageApplications} />
        </TabsContent>
        <TabsContent value="keys" className="mt-4">
          <ApiKeysTab canManage={canManageKeys} />
        </TabsContent>
        <TabsContent value="webhooks" className="mt-4">
          <WebhooksTab canManage={canManageWebhooks} />
        </TabsContent>
        <TabsContent value="logs" className="mt-4">
          <ApiLogsTab />
        </TabsContent>
        <TabsContent value="docs" className="mt-4">
          <DocumentationTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
