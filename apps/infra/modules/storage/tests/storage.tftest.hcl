mock_provider "cloudflare" {}

variables {
  account_id   = "00000000000000000000000000000000"
  jurisdiction = "us"
  databases = {
    main = { name = "app-main-staging" }
  }
  buckets = {
    images     = { name = "app-images-staging" }
    files      = { name = "app-files-staging" }
    quarantine = { name = "app-quarantine-staging" }
  }
}

run "plans_one_resource_per_catalog_entry" {
  command = plan

  assert {
    condition     = length(cloudflare_d1_database.this) == length(var.databases)
    error_message = "D1のデータベースの数が資源一覧の項目数と一致しない"
  }

  assert {
    condition     = length(cloudflare_r2_bucket.this) == length(var.buckets)
    error_message = "R2のバケットの数が資源一覧の項目数と一致しない"
  }

  assert {
    condition     = alltrue([for k, d in cloudflare_d1_database.this : d.name == var.databases[k].name && d.account_id == var.account_id])
    error_message = "D1のデータベースの名前またはアカウントが資源一覧と一致しない"
  }

  assert {
    condition     = alltrue([for k, b in cloudflare_r2_bucket.this : b.name == var.buckets[k].name && b.account_id == var.account_id])
    error_message = "R2のバケットの名前またはアカウントが資源一覧と一致しない"
  }

  assert {
    condition     = output.bucket_names == { for k, b in var.buckets : k => b.name }
    error_message = "バケット名の出力が資源一覧のキーと名前の対応と一致しない"
  }

  assert {
    condition     = toset(keys(output.database_ids)) == toset(keys(var.databases))
    error_message = "データベースの識別子の出力のキーが資源一覧のキーと一致しない"
  }
}

run "places_every_resource_in_us_jurisdiction" {
  command = plan

  assert {
    condition     = alltrue([for d in cloudflare_d1_database.this : d.jurisdiction == "us"])
    error_message = "D1のデータベースの管轄が米国でない"
  }

  assert {
    condition     = alltrue([for b in cloudflare_r2_bucket.this : b.jurisdiction == "us"])
    error_message = "R2のバケットの管轄が米国でない"
  }
}

run "disables_d1_read_replication_without_location_hint" {
  command = plan

  assert {
    condition     = alltrue([for d in cloudflare_d1_database.this : d.read_replication.mode == "disabled"])
    error_message = "D1の読み取りレプリカが無効になっていない"
  }

  assert {
    condition     = alltrue([for d in cloudflare_d1_database.this : d.primary_location_hint == null])
    error_message = "D1にロケーションヒントが指定されている"
  }

  assert {
    condition     = alltrue([for b in cloudflare_r2_bucket.this : b.storage_class == "Standard"])
    error_message = "R2のバケットの保存クラスが標準でない"
  }
}

run "adds_resources_by_adding_catalog_entries" {
  command = plan

  variables {
    buckets = {
      images     = { name = "app-images-staging" }
      files      = { name = "app-files-staging" }
      quarantine = { name = "app-quarantine-staging" }
      exports    = { name = "app-exports-staging" }
    }
  }

  assert {
    condition     = length(cloudflare_r2_bucket.this) == 4
    error_message = "資源一覧に加えたバケットが計画されない"
  }

  assert {
    condition     = cloudflare_r2_bucket.this["exports"].jurisdiction == "us"
    error_message = "資源一覧に加えたバケットの管轄が米国でない"
  }
}

run "rejects_default_jurisdiction" {
  command = plan

  variables {
    jurisdiction = "default"
  }

  expect_failures = [var.jurisdiction]
}

run "rejects_empty_jurisdiction" {
  command = plan

  variables {
    jurisdiction = ""
  }

  expect_failures = [var.jurisdiction]
}
