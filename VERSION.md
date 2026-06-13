# Version History

| Version | Changes |
| :--- | :--- |
| **Version 1.0.0-alpha2** | **UNDER THE HOOD**<br>- Added persistent sprite caching to the 2D canvas to stop memory spikes and frame drops when using the brush tools.<br>- Refactored the core procedural engine to utilise array buffer pooling. This prevents memory leaks and significantly reduces garbage collection stutters when rapidly painting complex terrain. |
| **Version 1.0.0-alpha1** | **Initial Alpha Release** A preview release to see the physical geography creation and editing tools. |
