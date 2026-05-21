# This will be my greatest work

## Change
* Pushing to fvtt? Add PUBLIC_REPO_TOKEN to this new REPO.
* Edit module.json fields: _id_, _title_, _description_, _styles_, _manifest_ and _download_
  **ATTENTION** the _id_ needs to be coordinated with changes to both _manifest_ and _download_. 
* Edit github `.github/workflows/auto-release.yaml` 
  
  ```
    # Replace MODULE-FOUNDRY-ID with the name of module id used in module.json
    jobs:
      release:
        runs-on: ubuntu-latest
    env:
        PUBLIC_REPO: Filroden/fvtt
        PUBLIC_LATEST_RELEASE_TAG: MODULE-FOUNDRY-ID-latest
        PUBLIC_RELEASE_MSG: Whatever description you want
        MODULE_ZIP_NAME: MODULE-FOUNDRY-ID.zip
  ```
* Edit `.github/workflows/auto-release.yaml` and replace `change-me-to-main` to `main`
    ```
    on:
      push:
        branches:
          - change-me-to-main
    ```
