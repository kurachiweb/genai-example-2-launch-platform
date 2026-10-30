mock_provider "cloudflare" {}

mock_provider "infisical" {}

variables {
  state_passphrase = "test-passphrase-0123456789"
}

run "wires_staging_catalog_into_modules" {
  command = plan

  variables {
    environment = "staging"
  }

  assert {
    condition     = local.catalog.environment == "staging"
    error_message = "stagingの資源一覧が読み込まれていない"
  }

  assert {
    condition     = toset(keys(module.storage.database_ids)) == toset(["main"])
    error_message = "D1のデータベースが資源一覧のキーどおりに計画されない"
  }

  assert {
    condition = module.storage.bucket_names == {
      images     = "genai-example-2-images-staging"
      files      = "genai-example-2-files-staging"
      quarantine = "genai-example-2-quarantine-staging"
    }
    error_message = "R2のバケットが資源一覧の名前どおりに計画されない"
  }

  assert {
    condition     = toset(keys(module.messaging.queue_ids)) == toset(["jobs", "jobs-dlq", "email-events"])
    error_message = "Queueが資源一覧のキーどおりに計画されない"
  }

  assert {
    condition = module.worker_routing.hostnames == {
      api    = "genai-example-2-api-staging.lab.kurachiweb.com"
      event  = "genai-example-2-event-staging.lab.kurachiweb.com"
      client = "genai-example-2-client-staging.lab.kurachiweb.com"
      admin  = "genai-example-2-admin-staging.lab.kurachiweb.com"
      images = "genai-example-2-images-staging.lab.kurachiweb.com"
    }
    error_message = "ホスト名の割り当てが資源一覧のホスト名どおりに計画されない"
  }

  assert {
    condition = local.worker_domains == {
      api    = { hostname = "genai-example-2-api-staging.lab.kurachiweb.com", service = "genai-example-2-api-staging" }
      event  = { hostname = "genai-example-2-event-staging.lab.kurachiweb.com", service = "genai-example-2-event-staging" }
      client = { hostname = "genai-example-2-client-staging.lab.kurachiweb.com", service = "genai-example-2-client-staging" }
      admin  = { hostname = "genai-example-2-admin-staging.lab.kurachiweb.com", service = "genai-example-2-admin-staging" }
      images = { hostname = "genai-example-2-images-staging.lab.kurachiweb.com", service = "genai-example-2-event-staging" }
    }
    error_message = "ホスト名の割り当て先が資源一覧のWorkerのキーからWorker名へ引き直されていない"
  }

  assert {
    condition = local.turnstile == {
      name    = "genai-example-2-staging"
      domains = ["genai-example-2-client-staging.lab.kurachiweb.com", "genai-example-2-admin-staging.lab.kurachiweb.com"]
      mode    = "invisible"
    }
    error_message = "Turnstileの名前・対象のホスト名・モードが資源一覧と一致しない"
  }

  assert {
    condition = module.storage.placement == {
      account_ids   = toset([local.catalog.cloudflare.accountId])
      jurisdictions = toset(["us"])
    }
    error_message = "D1・R2が資源一覧のアカウントと管轄に計画されない"
  }

  assert {
    condition = module.messaging.placement == {
      account_ids   = toset([local.catalog.cloudflare.accountId])
      jurisdictions = toset(["us"])
    }
    error_message = "Queueが資源一覧のアカウントと管轄に計画されない"
  }

  assert {
    condition = module.worker_routing.placement == {
      account_ids = toset([local.catalog.cloudflare.accountId])
      zone_ids    = toset([local.catalog.cloudflare.zoneId])
    }
    error_message = "ホスト名の割り当てが資源一覧のアカウントとゾーンに計画されない"
  }

  assert {
    condition = module.edge_services.placement == {
      account_ids          = toset([local.catalog.cloudflare.accountId])
      zone_ids             = toset([local.catalog.cloudflare.zoneId])
      web_analytics_host   = "genai-example-2-client-staging.lab.kurachiweb.com"
      email_sending_domain = "genai-example-2-mail-staging.lab.kurachiweb.com"
    }
    error_message = "bot判定・アクセス解析・メール送信のアカウント・ゾーン・アクセス解析のホスト名・送信ドメインが資源一覧と一致しない"
  }

  assert {
    condition     = toset(keys(output.resource_ids)) == toset(["d1", "turnstile_sitekey", "web_analytics_site_token"])
    error_message = "出力が秘密でない識別子(D1・Turnstileのサイトキー・アクセス解析のトークン)だけになっていない"
  }
}

run "wires_prod_catalog_into_modules" {
  command = plan

  variables {
    environment = "prod"
  }

  assert {
    condition     = local.catalog.environment == "prod"
    error_message = "prodの資源一覧が読み込まれていない"
  }

  assert {
    condition     = toset(keys(module.storage.database_ids)) == toset(["main"])
    error_message = "D1のデータベースが資源一覧のキーどおりに計画されない"
  }

  assert {
    condition = module.storage.bucket_names == {
      images     = "genai-example-2-images-prod"
      files      = "genai-example-2-files-prod"
      quarantine = "genai-example-2-quarantine-prod"
    }
    error_message = "R2のバケットが資源一覧の名前どおりに計画されない"
  }

  assert {
    condition     = toset(keys(module.messaging.queue_ids)) == toset(["jobs", "jobs-dlq", "email-events"])
    error_message = "Queueが資源一覧のキーどおりに計画されない"
  }

  assert {
    condition = local.worker_domains == {
      api    = { hostname = "genai-example-2-api.lab.kurachiweb.com", service = "genai-example-2-api-prod" }
      event  = { hostname = "genai-example-2-event.lab.kurachiweb.com", service = "genai-example-2-event-prod" }
      client = { hostname = "genai-example-2-client.lab.kurachiweb.com", service = "genai-example-2-client-prod" }
      admin  = { hostname = "genai-example-2-admin.lab.kurachiweb.com", service = "genai-example-2-admin-prod" }
      images = { hostname = "genai-example-2-images.lab.kurachiweb.com", service = "genai-example-2-event-prod" }
    }
    error_message = "ホスト名の割り当て先が資源一覧のWorkerのキーからWorker名へ引き直されていない"
  }

  assert {
    condition = local.turnstile == {
      name    = "genai-example-2-prod"
      domains = ["genai-example-2-client.lab.kurachiweb.com", "genai-example-2-admin.lab.kurachiweb.com"]
      mode    = "invisible"
    }
    error_message = "Turnstileの名前・対象のホスト名・モードが資源一覧と一致しない"
  }

  assert {
    condition = module.storage.placement == {
      account_ids   = toset([local.catalog.cloudflare.accountId])
      jurisdictions = toset(["us"])
    }
    error_message = "D1・R2が資源一覧のアカウントと管轄に計画されない"
  }

  assert {
    condition = module.messaging.placement == {
      account_ids   = toset([local.catalog.cloudflare.accountId])
      jurisdictions = toset(["us"])
    }
    error_message = "Queueが資源一覧のアカウントと管轄に計画されない"
  }

  assert {
    condition = module.worker_routing.placement == {
      account_ids = toset([local.catalog.cloudflare.accountId])
      zone_ids    = toset([local.catalog.cloudflare.zoneId])
    }
    error_message = "ホスト名の割り当てが資源一覧のアカウントとゾーンに計画されない"
  }

  assert {
    condition = module.edge_services.placement == {
      account_ids          = toset([local.catalog.cloudflare.accountId])
      zone_ids             = toset([local.catalog.cloudflare.zoneId])
      web_analytics_host   = "genai-example-2-client.lab.kurachiweb.com"
      email_sending_domain = "genai-example-2-mail.lab.kurachiweb.com"
    }
    error_message = "bot判定・アクセス解析・メール送信のアカウント・ゾーン・アクセス解析のホスト名・送信ドメインが資源一覧と一致しない"
  }

  assert {
    condition     = toset(keys(output.resource_ids)) == toset(["d1", "turnstile_sitekey", "web_analytics_site_token"])
    error_message = "出力が秘密でない識別子(D1・Turnstileのサイトキー・アクセス解析のトークン)だけになっていない"
  }
}

run "rejects_unknown_environment" {
  command = plan

  variables {
    environment = "dev"
  }

  expect_failures = [var.environment]
}
