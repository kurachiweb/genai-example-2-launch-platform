mock_provider "cloudflare" {}

variables {
  account_id = "00000000000000000000000000000000"
  zone_id    = "00000000000000000000000000000000"
  domains = {
    api    = { hostname = "app-api-staging.example", service = "app-api-staging" }
    event  = { hostname = "app-event-staging.example", service = "app-event-staging" }
    client = { hostname = "app-client-staging.example", service = "app-client-staging" }
    admin  = { hostname = "app-admin-staging.example", service = "app-admin-staging" }
    images = { hostname = "app-images-staging.example", service = "app-event-staging" }
  }
}

run "maps_each_hostname_to_its_worker" {
  command = plan

  assert {
    condition     = length(cloudflare_workers_custom_domain.this) == length(var.domains)
    error_message = "カスタムドメインの数が資源一覧のホスト名の数と一致しない"
  }

  assert {
    condition     = alltrue([for k, d in cloudflare_workers_custom_domain.this : d.hostname == var.domains[k].hostname && d.service == var.domains[k].service])
    error_message = "カスタムドメインのホスト名とWorker名の対応が資源一覧と一致しない"
  }

  assert {
    condition     = cloudflare_workers_custom_domain.this["images"].service == "app-event-staging"
    error_message = "画像配信のホスト名がイベントサーバーのWorkerに割り当てられていない"
  }

  assert {
    condition     = alltrue([for d in cloudflare_workers_custom_domain.this : d.account_id == var.account_id && d.zone_id == var.zone_id])
    error_message = "カスタムドメインのアカウントまたはゾーンが資源一覧と一致しない"
  }

  assert {
    condition     = output.hostnames == { for k, d in var.domains : k => d.hostname }
    error_message = "ホスト名の出力が資源一覧のキーとホスト名の対応と一致しない"
  }
}

run "adds_custom_domains_by_adding_catalog_entries" {
  command = plan

  variables {
    domains = {
      api    = { hostname = "app-api-staging.example", service = "app-api-staging" }
      event  = { hostname = "app-event-staging.example", service = "app-event-staging" }
      client = { hostname = "app-client-staging.example", service = "app-client-staging" }
      admin  = { hostname = "app-admin-staging.example", service = "app-admin-staging" }
      images = { hostname = "app-images-staging.example", service = "app-event-staging" }
      files  = { hostname = "app-files-staging.example", service = "app-event-staging" }
    }
  }

  assert {
    condition     = length(cloudflare_workers_custom_domain.this) == 6
    error_message = "資源一覧に加えたホスト名が計画されない"
  }

  assert {
    condition     = cloudflare_workers_custom_domain.this["files"].hostname == "app-files-staging.example" && cloudflare_workers_custom_domain.this["files"].service == "app-event-staging"
    error_message = "資源一覧に加えたホスト名とWorker名の対応が計画と一致しない"
  }
}
