# Version History

| Version | Changes |
| :--- | :--- |
| **Version 1.0.0-alpha2** | **FEATURES**<br>- **Export to PNG:** Maps can now be exported as a full resolution PNG from the main toolbar. This is a temporary feature until more extensive export features are added.<br><br>**IMPROVEMENTS**<br>- Entering 3D View now hides all tool sidebars.<br>- Changing tools while Edit mode is active will now disable the edit mode.<br><br>**BUG FIXES**<br>- Fixed an issue where performing a Quick Save would not visually update the map summary in the journal entry due to a missing embedded document ID. This did not affect the actual saved map data.<br><br>**UNDER THE HOOD**<br>- Added persistent sprite caching to the 2D canvas to stop memory spikes and frame drops when using the brush tools.<br>- Refactored the core procedural engine to utilise array buffer pooling. This prevents memory leaks and significantly reduces garbage collection stutters when rapidly painting complex terrain. |
| **Version 1.0.0-alpha1** | **Initial Alpha Release** A preview release to see the physical geography creation and editing tools. |
