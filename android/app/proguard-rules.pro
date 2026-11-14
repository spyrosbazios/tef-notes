# A widget's actions are named by class and made by reflection (Glance's actionRunCallback).
-keep class * implements androidx.glance.appwidget.action.ActionCallback { <init>(); }
