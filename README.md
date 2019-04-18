# loopback-azure-storage-provider

This is a provider for loopback-component-storage to deal with Azure Storage file share.

I've built this package because pkgcloud doesn't seem to update Azure Storage management which is not working.

this provider is based on Microsoft azure-storage package.

# Install

```bash
$ npm install loopback-azure-storage-provider
```

# Datasource settings

```json
{
  "myAzureStorage": {
    "name": "myAzureStorage",
    "connector": "loopback-component-storage",
    "provider": "loopback-azure-storage-provider",
    "share": "{{THE NAME OF THE FILE SHARE}}",
    "storageAccount": "{{THE NAME OF AZURE STORAGE ACCOUNT}}",
    "storageAccessKey": "{{AZURE STORAGE ACCESS KEY}}"
  }
}
```

# TODO

Implement translations for strong-globalize

